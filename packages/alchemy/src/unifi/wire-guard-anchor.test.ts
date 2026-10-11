/**
 * The wire guard's ANCHORING, redirect handling and redaction — red team round 1 on PR 377.
 * The first block runs a real `Bun.serve` through the real `FetchHttpClient` (no fake fetch), because
 * the redirect finding is about what real fetch does with the fiber's `RequestInit`.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import * as HttpClient from 'effect/http/HttpClient';
import * as HttpClientRequest from 'effect/http/HttpClientRequest';
import { networkAllowedWrite } from './network.ts';
import { GetOnlyHttpClient, UnifiRefusedRequest, guardedHttpClient } from './wire-guard.ts';

const hits: Array<{ method: string; path: string }> = [];
let status = 307;
const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(req) {
    const u = new URL(req.url);
    hits.push({ method: req.method, path: u.pathname + u.search });
    return u.pathname.endsWith('/networks/n')
      ? new Response(null, { status, headers: { location: '/elsewhere/v1/sites/s/networks/O' } })
      : Response.json({ ok: true });
  },
});
afterAll(() => server.stop(true));

const ROOT = '/proxy/network/integration';
const PORT = server.port as number;
const BASE = `http://127.0.0.1:${PORT}${ROOT}`;
const ALLOW = [networkAllowedWrite({ siteId: 's', networkId: 'n' } as never)];

const call = (
  method: string,
  url: string,
  base: string | null = BASE,
  outer: FetchHttpClient.RequestInit['Service'] = {},
) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      return yield* client.execute(
        HttpClientRequest.make(method as never)(url).pipe(
          HttpClientRequest.bodyText('{"x":1}', 'application/json'),
        ),
      );
    }).pipe(
      Effect.provide(guardedHttpClient(ALLOW, base ?? undefined)),
      // ⛔ An OUTER RequestInit on the calling fiber: `layerMergedContext` lets it replace the guard's.
      Effect.provideService(FetchHttpClient.RequestInit, outer),
      Effect.provide(FetchHttpClient.layer),
    ),
  );

const refusal = (exit: Exit.Exit<unknown, unknown>) => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) throw new Error('unreachable');
  expect(Cause.hasDies(exit.cause)).toBe(true);
  const defect = Cause.squash(exit.cause);
  expect(defect).toBeInstanceOf(UnifiRefusedRequest);
  return defect as UnifiRefusedRequest;
};

describe('redirect: manual survives an OUTER FetchHttpClient.RequestInit', () => {
  test('outer RequestInit, real 307 => exactly one request, then the refusal', async () => {
    status = 307;
    hits.length = 0;
    const exit = await call('PUT', `${BASE}/v1/sites/s/networks/n`, BASE, {
      keepalive: false,
    });
    expect(refusal(exit).message).toContain('307 redirect');
    expect(hits).toEqual([{ method: 'PUT', path: `${ROOT}/v1/sites/s/networks/n` }]);
  });

  // ⚠️ Mutation gap: narrowing the 3xx check to 307 only. Real fetch with redirect:manual returns
  //   each of these as-is, and the guard must refuse every one.
  test.each([301, 302, 303, 307, 308])('a %d answer is refused', async (code) => {
    status = code;
    hits.length = 0;
    refusal(await call('PUT', `${BASE}/v1/sites/s/networks/n`));
    expect(hits).toHaveLength(1);
  });

  test('a 3xx answer to HEAD is refused too (HEAD is not GET)', async () => {
    status = 302;
    // HEAD is not on the allow list, so it dies at the request guard before any redirect exists.
    hits.length = 0;
    refusal(await call('HEAD', `${BASE}/v1/sites/s/networks/n`));
    expect(hits).toEqual([]);
  });
});

describe('a 3xx answer to a GET is refused under BOTH postures (2026-10-10 symmetry fix)', () => {
  // ⛔ ROUND-2 FINDING: `redirect: 'manual'` was scoped to a non-empty allow list, so reconcile's
  //   OWN GETs surfaced a raw 3xx and failed the SDK decode, while read/diff's GETs silently
  //   followed it. Both postures must behave identically — and a followed GET re-sends the request,
  //   API-key header included, to a URL the guard never vetted — so both refuse it, never follow.
  //   Real fetch, no fake: the point is what fetch does with the fiber's `RequestInit`.
  test.each([
    ['GetOnlyHttpClient (read/diff/delete)', () => GetOnlyHttpClient],
    ['the row allow list (reconcile)', () => guardedHttpClient(ALLOW, BASE)],
  ])('%s: refused, never followed', async (_n, layer) => {
    status = 301;
    hits.length = 0;
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        return yield* client.execute(HttpClientRequest.get(`${BASE}/v1/sites/s/networks/n`));
      }).pipe(Effect.provide(layer()), Effect.provide(FetchHttpClient.layer)),
    );
    const defect = refusal(exit);
    expect(defect.method).toBe('GET');
    expect(defect.message).toContain('301 redirect');
    // Exactly ONE request reached the server: the redirect was never followed.
    expect(hits).toEqual([{ method: 'GET', path: `${ROOT}/v1/sites/s/networks/n` }]);
  });
});

describe('the allowed path is anchored to the configured base URL', () => {
  test('the exact route passes', async () => {
    status = 200;
    hits.length = 0;
    expect(Exit.isSuccess(await call('PUT', `${BASE}/v1/sites/s/networks/n`))).toBe(true);
    expect(hits).toHaveLength(1);
  });

  test.each([
    ['a query string', `${ROOT}/v1/sites/s/networks/n?force=true`],
    ['a nested route', `${ROOT}/v1/sites/OTHER/v1/sites/s/networks/n`],
    ['a doubled slash', `${ROOT}//v1/sites/s/networks/n`],
    ['a doubled slash at the root', `//v1/sites/s/networks/n`],
    ['a trailing slash', `${ROOT}/v1/sites/s/networks/n/`],
    ['a fragment', `${ROOT}/v1/sites/s/networks/n#frag`],
    ['a different base path', `/totally/different/v1/sites/s/networks/n`],
  ])('%s is refused before the transport', async (_n, path) => {
    status = 200;
    hits.length = 0;
    refusal(await call('PUT', `http://127.0.0.1:${PORT}${path}`));
    expect(hits).toEqual([]);
  });

  test('another origin is refused even with the right path', async () => {
    hits.length = 0;
    refusal(await call('PUT', `http://127.0.0.1:${PORT + 1}${ROOT}/v1/sites/s/networks/n`));
    expect(hits).toEqual([]);
  });

  test('no configured base URL allows nothing (fail closed)', async () => {
    hits.length = 0;
    refusal(await call('PUT', `${BASE}/v1/sites/s/networks/n`, null));
    expect(hits).toEqual([]);
  });

  // ⚠️ Mutation gap: a regex-escaped id. A `.` in an id must be literal, never "any character".
  test('an id is compared as text, never as a pattern', async () => {
    status = 200;
    const dotted = [networkAllowedWrite({ siteId: 's', networkId: 'a.c' } as never)];
    const run = (id: string) =>
      Effect.runPromiseExit(
        Effect.gen(function* () {
          const client = yield* HttpClient.HttpClient;
          return yield* client.execute(
            HttpClientRequest.put(`${BASE}/v1/sites/s/networks/${id}`).pipe(
              HttpClientRequest.bodyText('{}', 'application/json'),
            ),
          );
        }).pipe(
          Effect.provide(guardedHttpClient(dotted, BASE)),
          Effect.provide(FetchHttpClient.layer),
        ),
      );
    expect(Exit.isSuccess(await run('a.c'))).toBe(true);
    refusal(await run('abc'));
  });
});

describe('refusal messages redact the cloud connector Console ID', () => {
  test('the segment after consoles/ never reaches the message or the path field', async () => {
    const cloud =
      'https://api.ui.com/v1/connector/consoles/SECRET-CONSOLE-ID/proxy/network/integration';
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        return yield* client.execute(HttpClientRequest.put(`${cloud}/v1/sites/s/networks/OTHER`));
      }).pipe(
        Effect.provide(guardedHttpClient(ALLOW, cloud)),
        Effect.provide(FetchHttpClient.layer),
      ),
    );
    const defect = refusal(exit);
    expect(defect.message).not.toContain('SECRET-CONSOLE-ID');
    expect(defect.path).not.toContain('SECRET-CONSOLE-ID');
    expect(defect.path).toContain('/consoles/<redacted>/proxy/network/integration');
  });
});
