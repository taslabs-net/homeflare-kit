/**
 * `guardedHttpClient` (`wire-guard.ts`, B0a/T12) in isolation — against a bare `HttpClient`
 * service, no `CredentialsFromEnv`, no real SDK operation — plus its installation in
 * `unifiHandlers`. A `GET` reaches the wrapped transport; any other method dies with
 * `UnifiRefusedRequest` BEFORE the fake server sees it (`fake.seen` stays empty) unless the row's
 * allow entry names exactly that `(method, path)`.
 *
 * ⚠️ HISTORY (2026-09-26, red team, IMPORTANT-1): deleting `Effect.provide(GetOnlyHttpClient)` from
 *   `withCredentials` once left every test green, because the family tests call `unifiOperations`
 *   directly and bypass `unifiHandlers`. The `unifiHandlers` block below drives the real handler
 *   entry points through a `ConfigProvider` override (the pattern `opnsense/write-refusal.test.ts`
 *   uses for `CredentialsFromEnv`), so it fails if a guard is ever removed from `withCredentials`.
 * ★ `fakeUnifi` records `seen` BEFORE calling `route`, so even a route that would throw still proves
 *   whether the guard let a request through — the assertions are on `seen`, never on a caught throw.
 */
import { describe, expect, test } from 'bun:test';
import * as Cause from 'effect/Cause';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/http/HttpClient';
import type * as HttpClientError from 'effect/http/HttpClientError';
import * as HttpClientRequest from 'effect/http/HttpClientRequest';
import { FAKE_BASE, FAKE_KEY, fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import { networkAllowedWrite } from './network.ts';
import { type UnifiSpec, unifiHandlers } from './resource.ts';
import { GetOnlyHttpClient, UnifiRefusedRequest, guardedHttpClient } from './wire-guard.ts';

const ROOT = '/proxy/network/integration';
const NET_PATH = `${ROOT}/v1/sites/s/networks/n`;
const ALLOW = [networkAllowedWrite({ siteId: 's', networkId: 'n' } as never)];
const url = (path: string) => `https://unifi.example.com${path}`;

const send = (
  method: string,
  path: string,
  fetchFn: typeof globalThis.fetch,
  guard: Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient>,
) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      return yield* client.execute(HttpClientRequest.make(method as never)(url(path)));
    }).pipe(Effect.provide(guard), Effect.provide(fakeUnifiLayer(fetchFn))),
  );

const expectRefused = (exit: Exit.Exit<unknown, unknown>, method?: string) => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) return;
  expect(Cause.hasDies(exit.cause)).toBe(true);
  expect(Cause.hasFails(exit.cause)).toBe(false);
  const defect = Cause.squash(exit.cause);
  expect(defect).toBeInstanceOf(UnifiRefusedRequest);
  if (method) expect((defect as UnifiRefusedRequest).method).toBe(method);
};

const neverReached = (what: string) =>
  fakeUnifi(() => {
    throw new Error(`wire-guard.test.ts: unexpected ${what} reached the fake transport`);
  });

describe('GetOnlyHttpClient (empty allow list)', () => {
  test('a GET passes through unchanged and reaches the transport', async () => {
    const fake = fakeUnifi(() => Response.json({ ok: true }));
    const exit = await send('GET', `${ROOT}/v1/sites/s/networks`, fake.fetch, GetOnlyHttpClient);
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(fake.seen).toEqual([{ method: 'GET', path: `${ROOT}/v1/sites/s/networks` }]);
  });

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s dies before the transport', async (method) => {
    const fake = neverReached(method);
    expectRefused(await send(method, NET_PATH, fake.fetch, GetOnlyHttpClient), method);
    // ⛔ THE PROOF: the transport never recorded the call -- refused in `mapRequestEffect`.
    expect(fake.seen).toEqual([]);
  });
});

describe('guardedHttpClient with the row allow entry', () => {
  test('the one PUT to this row reaches the transport, with fetch redirect: manual', async () => {
    const fake = fakeUnifi(() => Response.json({ ok: true }));
    const exit = await send('PUT', NET_PATH, fake.fetch, guardedHttpClient(ALLOW));
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(fake.seen).toEqual([{ method: 'PUT', path: NET_PATH, redirect: 'manual' }]);
  });

  test.each([
    ['the list route', 'PUT', `${ROOT}/v1/sites/s/networks`],
    ['another network id', 'PUT', `${ROOT}/v1/sites/s/networks/other`],
    ['an id this one is a prefix of', 'PUT', `${ROOT}/v1/sites/s/networks/n2`],
    ['a sub-route of this network', 'PUT', `${NET_PATH}/extra`],
    ['an id this one is a suffix of', 'PUT', `${ROOT}/v1/sites/s/networks/xn`],
    ['another site', 'PUT', `${ROOT}/v1/sites/t/networks/n`],
    ['another family', 'PUT', `${ROOT}/v1/sites/s/firewall/zones/z`],
    ['POST on the row path', 'POST', NET_PATH],
    ['PATCH on the row path', 'PATCH', NET_PATH],
    ['DELETE on the row path', 'DELETE', NET_PATH],
  ])('%s dies before the transport', async (_name, method, path) => {
    const fake = neverReached(`${method} ${path}`);
    expectRefused(await send(method, path, fake.fetch, guardedHttpClient(ALLOW)), method);
    expect(fake.seen).toEqual([]);
  });

  test('a 307 answer to the allowed PUT dies after exactly one request, never followed', async () => {
    const fake = fakeUnifi(
      () => new Response(null, { status: 307, headers: { location: 'https://evil.example/x' } }),
    );
    expectRefused(await send('PUT', NET_PATH, fake.fetch, guardedHttpClient(ALLOW)), 'PUT');
    expect(fake.seen).toHaveLength(1);
    expect(fake.seen[0]?.redirect).toBe('manual');
  });
});

interface ProbeProps {
  id: string;
}

/** A `fetchLive` that sends one raw request of the given method (not a real SDK operation). */
const probeSpec = (
  method: string,
  withUpdate = false,
): UnifiSpec<ProbeProps, ProbeProps, ProbeProps, HttpClientError.HttpClientError> => ({
  type: 'Test.Probe',
  describe: (props) => `probe/${props.id}`,
  fetchLive: (props) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      yield* client.execute(HttpClientRequest.make(method as never)(`${FAKE_BASE}/probe`));
      return props;
    }),
  attributes: (live) => live,
  matches: () => true,
  ...(withUpdate
    ? {
        update: {
          allowedWrite: () => ({ method: 'PUT' as const, path: /\/probe$/ }),
          patchKeys: [],
          driftOf: () => [],
          write: (live: ProbeProps) => Effect.succeed(live),
        },
      }
    : {}),
});

const configProvider = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    UNIFI_NETWORK_API_BASE_URL: FAKE_BASE,
    UNIFI_NETWORK_API_KEY: FAKE_KEY,
  }),
);
const session = { note: () => Effect.void };
const args = { news: { id: 'w1' }, olds: undefined, output: undefined, session };

const runHandler = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  fetchFn: typeof globalThis.fetch,
): Promise<Exit.Exit<A, E>> =>
  Effect.runPromiseExit(
    effect.pipe(Effect.provide(Layer.mergeAll(fakeUnifiLayer(fetchFn), configProvider))) as never,
  ) as never;

describe('guards are installed in unifiHandlers (IMPORTANT-1, red team 2026-09-26)', () => {
  test('a GET through the real read entry point reaches the transport', async () => {
    const fake = fakeUnifi(() => Response.json({ id: 'w1' }));
    const exit = await runHandler(
      unifiHandlers(probeSpec('GET')).read({ olds: { id: 'w1' }, output: undefined }),
      fake.fetch,
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(fake.seen).toEqual([{ method: 'GET', path: `${ROOT}/probe` }]);
  });

  test('read dies on a PUT even when the spec declares update (guard scope is reconcile only)', async () => {
    const fake = neverReached('PUT');
    const exit = await runHandler(
      unifiHandlers(probeSpec('PUT', true)).read({ olds: { id: 'w1' }, output: undefined }),
      fake.fetch,
    );
    expectRefused(exit, 'PUT');
    expect(fake.seen).toEqual([]);
  });

  test('reconcile dies on a PUT when the spec has no update (firewall-zone style)', async () => {
    const fake = neverReached('PUT');
    expectRefused(await runHandler(unifiHandlers(probeSpec('PUT')).reconcile(args), fake.fetch));
    expect(fake.seen).toEqual([]);
  });

  test('reconcile lets the allowed PUT through when the spec declares update', async () => {
    const fake = fakeUnifi(() => Response.json({ id: 'w1' }));
    const exit = await runHandler(
      unifiHandlers(probeSpec('PUT', true)).reconcile(args),
      fake.fetch,
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(fake.seen.map((s) => s.method)).toEqual(['PUT']);
  });

  test('reconcile still dies on a POST even when the spec declares update', async () => {
    const fake = neverReached('POST');
    expectRefused(
      await runHandler(unifiHandlers(probeSpec('POST', true)).reconcile(args), fake.fetch),
      'POST',
    );
    expect(fake.seen).toEqual([]);
  });
});
