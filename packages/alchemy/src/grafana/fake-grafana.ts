/**
 * A minimal in-memory Grafana HTTP API for this family's tests — an in-memory `fetch` handed to
 * Effect's real `FetchHttpClient` through its `Fetch` reference, mirroring
 * `../forgejo/fake-forgejo.ts` and `../netbox/fake-netbox.ts`. Tests exercise distilled's REAL
 * path assembly, JSON encode/decode and status→typed-error matching (`404` → `NotFound`, `403` →
 * `Forbidden`, …) — nothing about that matching is re-implemented here, only the wire responses a
 * scenario needs.
 *
 * ⛔ TEST-ONLY, AND NO NETWORK. No provider imports this file. The base URL is RFC 2606
 *   `grafana.example.com`, and the token is a placeholder.
 */
import { type Credentials, fromApiKey } from '@distilled.cloud/grafana/Credentials';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';

export const FAKE_BASE = 'https://grafana.example.com';
export const FAKE_TOKEN = 'placeholder-grafana-token';

export type Seen = { readonly method: string; readonly path: string };

/** Grafana's `{ message?, status? }` failure envelope — matching the SDK's own protocol.ts note. */
export const fakeFailure = (status: number, message: string) =>
  Response.json({ message }, { status });

/**
 * `route` decides every response; this wrapper only records what was sent and adapts to
 * `globalThis.fetch`'s signature. A test that expects no request at all asserts `seen` is empty.
 *
 * ★ `bodies` IS A SEPARATE, PARALLEL ARRAY (index-matched to `seen`), NOT FOLDED INTO IT — so
 *   every existing `expect(fake.seen).toEqual([{method, path}, …])` stays exact rather than
 *   growing an unrelated `body` key it would then have to repeat on every entry. A test that
 *   cares what was actually sent (not just that a request was) reads `bodies[n]` instead of only
 *   checking a request landed — the request landing is not proof of what it carried.
 */
export const fakeGrafana = (route: (method: string, url: URL, body: unknown) => Response) => {
  const seen: Seen[] = [];
  const bodies: unknown[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    const text = await request.text();
    const body: unknown = text === '' ? undefined : JSON.parse(text);
    seen.push({ method: request.method, path: `${url.pathname}${url.search}` });
    bodies.push(body);
    return route(request.method, url, body);
  }) as typeof globalThis.fetch;
  return { fetch, seen, bodies };
};

/**
 * distilled `Credentials` (via the SDK's own `fromApiKey`) + the real `FetchHttpClient` over the
 * fake — `GrafanaOpContext`, what every resource file's exported `spec.fetchLive`/`create`/
 * `update`/`destroy` needs. Unlike `grafanaHandlers`'s production callers, this never touches
 * `process.env` — `grafanaCredentials` reads `tokenEnv` fresh per call (credentials.ts's own
 * note), which a test-time `process.env` mutation cannot reliably reach either (measured for the
 * same reason in the forgejo/netbox migrations: Effect's default `Config` provider snapshots the
 * environment). Passing an explicit layer exercises exactly the same production code without
 * that seam.
 */
export const fakeGrafanaLayer = (
  fetchFn: typeof globalThis.fetch,
  creds: Layer.Layer<Credentials> = fromApiKey({ apiBaseUrl: FAKE_BASE, apiKey: FAKE_TOKEN }),
) => Layer.mergeAll(creds, FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, fetchFn));
