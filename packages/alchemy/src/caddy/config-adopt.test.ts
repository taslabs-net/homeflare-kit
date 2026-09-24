/**
 * Ownership with no state — decision 2026-09-21: CaddyConfig never adopts silently. The adoption
 * probe (`read` with no output) and the apply of a create the engine never probed must agree on
 * what is claimable: the declared config itself, or a Caddy serving nothing. Anything else is
 * `Unowned` at plan time and refused at apply, unless the deploy runs with `--adopt` — and state
 * lends authority only over the Caddy it was applied to. Both drive the LIFECYCLE functions
 * directly; config-adopt-provider.test.ts drives the same scenarios through the real
 * `CaddyConfig.Provider` (its `Unowned` branding, its `--adopt` resolution).
 */
import { afterEach, describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientError from 'effect/unstable/http/HttpClientError';
import type { CaddyTransport } from './admin.ts';
import { isUnreachable } from './caddy-http-client.ts';
import { probeLive } from './config-lifecycle.ts';
import { reconcileConfig } from './config-reconcile.ts';
import { configDigest } from './digest.ts';
import { type FakeCaddy, fakeDefaultCaddy, runCaddy } from './fake-caddy.ts';

const SITE = 'app.example.com reverse_proxy 127.0.0.1:8080';
/** A config someone else loaded: it serves a site, and it is not what the stack declares. */
const FOREIGN = { apps: { http: { servers: { legacy: { listen: [':80'] } } } } };

let fake: FakeCaddy | undefined;
afterEach(() => {
  fake?.stop();
  fake = undefined;
});

const setup = (running?: unknown) => {
  const made = fakeDefaultCaddy(running);
  fake = made.caddy;
  return made;
};

/** A Caddy already running the declared config — as one started from caddyWithFile's file is. */
const runningDeclared = () => {
  const made = setup();
  made.caddy.running = made.caddy.adapt(SITE);
  return made;
};

const loads = (caddy: FakeCaddy) => caddy.seen.filter((call) => call.path === '/load');

/**
 * The same transport, except `/adapt` fails as though nothing were listening — for "Caddy
 * vanishing mid-probe": `probeLive` calls `GET /config/` first and `POST /adapt` second, so
 * stopping the fake server between them can't be timed from outside one Effect. Wrapping the
 * transport's `HttpClient.HttpClient` at exactly one path is the deterministic equivalent.
 */
const goneOnAdapt = (admin: CaddyTransport): CaddyTransport => ({
  ...admin,
  layer: Layer.effect(
    HttpClient.HttpClient,
    Effect.map(HttpClient.HttpClient, (real) =>
      HttpClient.make((request, url, signal, fiber) =>
        url.pathname === '/adapt'
          ? Effect.fail(
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({
                  cause: Object.assign(new Error('gone'), { code: 'ECONNREFUSED' }),
                  request,
                }),
              }),
            )
          : real.execute(request),
      ),
    ),
  ).pipe(Layer.provideMerge(admin.layer)),
});

describe('the probe: read with no state', () => {
  test('a Caddy already running the declared config is ours — adopting it changes nothing', async () => {
    const { admin, caddy } = runningDeclared();
    const probe = await runCaddy(probeLive(SITE), admin);
    expect(probe).toMatchObject({ attributes: { configSha256: configDigest(caddy.adapt(SITE)) } });
    expect(probe?.ours).toBe(true);
    expect(loads(caddy)).toHaveLength(0);
  });

  test('a Caddy running any other config is not ours', async () => {
    const { admin } = setup(FOREIGN);
    const probe = await runCaddy(probeLive(SITE, '/usr/local/etc/Caddyfile'), admin);
    expect(probe?.ours).toBe(false);
    expect(probe?.unchecked).toBeUndefined();
    expect(probe?.attributes).toEqual({
      configSha256: configDigest(FOREIGN),
      endpoint: fake?.address ?? '',
      sourceFile: '/usr/local/etc/Caddyfile',
    });
  });

  test.each([
    ['no config at all', null],
    ['only an admin block', { admin: { listen: 'localhost:2019' } }],
  ])('a Caddy serving nothing (%s) reads as absent: a create', async (_, running) => {
    const { admin } = setup(running);
    expect(await runCaddy(probeLive(SITE), admin)).toBeUndefined();
  });

  test.each([
    ['does not adapt', 'SYNTAX_ERROR', /Error during parsing/],
    ['is not plain text (a stripped Output)', undefined, /not plain text/],
  ])('a declaration that %s is not ours — and never fails the read', async (_, text, reason) => {
    // ⛔ The engine replays this read with an interrupted create's props: a throw here would fail
    //   every later plan, the one carrying the fix included.
    const { admin } = setup(FOREIGN);
    const probe = await runCaddy(probeLive(text), admin);
    expect(probe?.ours).toBe(false);
    expect(probe?.unchecked).toMatch(reason);
  });

  test('Caddy vanishing mid-probe stays "no Caddy", never "not ours"', async () => {
    const { admin } = setup(FOREIGN);
    const failure = runCaddy(probeLive(SITE), goneOnAdapt(admin));
    // ★ Still the raw, narrowable HttpClientError (config.ts's own catch is what turns THIS into
    //   "no Caddy" at plan time) — never swallowed into `{ ours: false, unchecked }`.
    await expect(failure).rejects.toBeInstanceOf(HttpClientError.HttpClientError);
    await expect(failure.catch((error: unknown) => isUnreachable(error))).resolves.toBe(true);
  });
});

/** A create the engine never probed, or state from another endpoint (config.ts decides which). */
describe('the apply without authority over the running config', () => {
  test('without authority, a config the stack cannot claim is refused before any load', async () => {
    const { admin, caddy } = setup(FOREIGN);
    await expect(
      runCaddy(reconcileConfig({ caddyfile: SITE }, { takeOver: false }), admin),
    ).rejects.toThrow(/which this stack did not load.*Deploy with --adopt/);
    expect(loads(caddy)).toHaveLength(0);
    expect(caddy.running).toEqual(FOREIGN);
  });

  test('the declared config already running is taken as it is — no load', async () => {
    const { admin, caddy } = runningDeclared();
    const applied = await runCaddy(
      reconcileConfig({ caddyfile: SITE }, { takeOver: false }),
      admin,
    );
    expect(applied.loaded).toBe(false);
    expect(loads(caddy)).toHaveLength(0);
  });

  test('a Caddy serving nothing is loaded — there is nothing to take over', async () => {
    const { admin, caddy } = setup();
    const applied = await runCaddy(
      reconcileConfig({ caddyfile: SITE }, { takeOver: false }),
      admin,
    );
    expect(applied.loaded).toBe(true);
    expect(configDigest(caddy.running)).toBe(configDigest(caddy.adapt(SITE)));
  });

  test('the config the state last stored is known — the same Caddy at a new endpoint', async () => {
    const { admin } = setup(FOREIGN);
    const authority = { stored: configDigest(FOREIGN), takeOver: false };
    const applied = await runCaddy(reconcileConfig({ caddyfile: SITE }, authority), admin);
    expect(applied.loaded).toBe(true);
  });

  test('with authority, the foreign config is replaced', async () => {
    const { admin, caddy } = setup(FOREIGN);
    const applied = await runCaddy(reconcileConfig({ caddyfile: SITE }, { takeOver: true }), admin);
    expect(applied.loaded).toBe(true);
    expect(configDigest(caddy.running)).toBe(configDigest(caddy.adapt(SITE)));
  });
});
