/**
 * Red team round 2 on PR 377, against the wire guard: an OUTER `RequestInit` that tries to turn
 * redirects back on (F2), a consumer transform that replaces `manual` (F3, the response-URL
 * backstop) and a query parameter added with `setUrlParam` (F5). Real `Bun.serve` + real fetch.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import * as HttpClient from 'effect/http/HttpClient';
import * as HttpClientRequest from 'effect/http/HttpClientRequest';
import { networkAllowedWrite } from './network.ts';
import { UnifiRefusedRequest, guardedHttpClient } from './wire-guard.ts';

const hits: Array<{ method: string; path: string }> = [];
const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(req) {
    const u = new URL(req.url);
    hits.push({ method: req.method, path: u.pathname + u.search });
    return u.pathname.endsWith('/networks/n')
      ? new Response(null, {
          status: 307,
          headers: { location: '/elsewhere/v1/sites/s/networks/O' },
        })
      : Response.json({ ok: true });
  },
});
afterAll(() => server.stop(true));

const BASE = `http://127.0.0.1:${server.port}/proxy/network/integration`;
const ALLOW = [networkAllowedWrite({ siteId: 's', networkId: 'n' } as never)];
const PUT = () =>
  HttpClientRequest.put(`${BASE}/v1/sites/s/networks/n`).pipe(
    HttpClientRequest.bodyText('{"x":1}', 'application/json'),
  );

const defectOf = (exit: Exit.Exit<unknown, unknown>) => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) throw new Error('unreachable');
  expect(Cause.hasDies(exit.cause)).toBe(true);
  const defect = Cause.squash(exit.cause);
  expect(defect).toBeInstanceOf(UnifiRefusedRequest);
  return defect as UnifiRefusedRequest;
};

describe('an OUTER RequestInit that asks to follow redirects (F2)', () => {
  test('redirect stays manual, and keepalive plus a tls option still reach fetch', async () => {
    hits.length = 0;
    const inits: Array<RequestInit & { tls?: unknown }> = [];
    const spy = ((url: string | URL | Request, init?: RequestInit) => {
      inits.push((init ?? {}) as RequestInit);
      return fetch(url, init);
    }) as typeof fetch;
    const exit = await Effect.runPromiseExit(
      HttpClient.HttpClient.pipe(
        Effect.flatMap((client) => client.execute(PUT())),
        Effect.provide(guardedHttpClient(ALLOW, BASE)),
        Effect.provideService(FetchHttpClient.RequestInit, {
          redirect: 'follow',
          keepalive: true,
          tls: { rejectUnauthorized: false },
        } as never),
        Effect.provideService(FetchHttpClient.Fetch, spy),
        Effect.provide(FetchHttpClient.layer),
      ),
    );
    expect(defectOf(exit).message).toContain('307 redirect');
    expect(hits).toHaveLength(1);
    expect(inits).toHaveLength(1);
    expect(inits[0]?.redirect).toBe('manual');
    expect(inits[0]?.keepalive).toBe(true);
    expect(inits[0]?.tls).toEqual({ rejectUnauthorized: false });
  });
});

describe('a consumer transform that replaces RequestInit without merging (F3 backstop)', () => {
  test('a followed redirect dies on the response URL, even though manual was lost', async () => {
    hits.length = 0;
    const consumer = Layer.effect(
      HttpClient.HttpClient,
      Effect.map(HttpClient.HttpClient, (client) =>
        HttpClient.transform(client, (effect) =>
          Effect.provideService(effect, FetchHttpClient.RequestInit, { redirect: 'follow' }),
        ),
      ),
    ).pipe(Layer.provide(FetchHttpClient.layer));
    const exit = await Effect.runPromiseExit(
      HttpClient.HttpClient.pipe(
        Effect.flatMap((client) => client.execute(PUT())),
        Effect.provide(guardedHttpClient(ALLOW, BASE)),
        Effect.provide(consumer),
      ),
    );
    // The redirect WAS followed (the consumer's transform won), so a second request hit the server...
    expect(hits.map((h) => h.path)).toContain('/elsewhere/v1/sites/s/networks/O');
    // ...but the guard refuses to hand the answer back as a success.
    expect(defectOf(exit).message).toContain('response URL differs');
  });
});

describe('query parameters added with setUrlParam (F5)', () => {
  test('a PUT with ?force=true built by setUrlParam is refused before the transport', async () => {
    hits.length = 0;
    const exit = await Effect.runPromiseExit(
      HttpClient.HttpClient.pipe(
        Effect.flatMap((client) =>
          client.execute(PUT().pipe(HttpClientRequest.setUrlParam('force', 'true'))),
        ),
        Effect.provide(guardedHttpClient(ALLOW, BASE)),
        Effect.provide(FetchHttpClient.layer),
      ),
    );
    defectOf(exit);
    expect(hits).toEqual([]);
  });
});
