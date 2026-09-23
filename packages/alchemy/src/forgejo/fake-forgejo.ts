/**
 * A minimal in-memory Forgejo v1 API for this family's tests — an in-memory `fetch` handed to
 * Effect's real `FetchHttpClient` through its `Fetch` reference, mirroring
 * `cloudflare/fake-mesh.ts`. Tests exercise distilled's REAL path assembly, JSON encode/decode
 * and status→typed-error matching (`404` → `NotFound`, `403` → `Forbidden`, …) — nothing about
 * that matching is re-implemented here, only the wire responses a scenario needs.
 *
 * ⛔ TEST-ONLY, AND NO NETWORK. No provider imports this file. The base URL is RFC 2606
 *   `forgejo.example.com`, and the token is a placeholder.
 */
import { type Credentials, credentials } from '@distilled.cloud/forgejo/Credentials';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';

export const FAKE_BASE = 'https://forgejo.example.com';
export const FAKE_TOKEN = 'placeholder-forgejo-token';

export type Seen = { readonly method: string; readonly path: string };

/** Forgejo's failure envelope — `{ message, url }` — matching protocol.ts's `errorEnvelope`. */
export const fakeFailure = (status: number, message: string) =>
  Response.json({ message, url: 'https://forgejo.example.com/api/v1/swagger' }, { status });

/**
 * `route` decides every response; this wrapper only records what was sent and adapts to
 * `globalThis.fetch`'s signature. A test that expects no request at all asserts `seen` is empty.
 */
export const fakeForgejo = (route: (method: string, url: URL) => Response) => {
  const seen: Seen[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    seen.push({ method: request.method, path: `${url.pathname}${url.search}` });
    return route(request.method, url);
  }) as typeof globalThis.fetch;
  return { fetch, seen };
};

/**
 * distilled Credentials + the real FetchHttpClient over the fake — `ForgejoOpContext`, what every
 * resource file's exported `spec.fetchLive` needs.
 *
 * ⚠️ NOT PAIRED WITH `handlers` (each resource file's `forgejoHandlers(spec)` export). `handlers`
 *   bakes in `CredentialsFromEnv`, which resolves `FORGEJO_URL` / `FORGEJO_TOKEN` through Effect's
 *   `Config` — whose default provider snapshots `process.env` once and never re-reads it (measured
 *   2026-09-23: mutating `process.env` mid-test-run had no effect). So a test cannot point
 *   `handlers` at a fake server; it calls `spec.fetchLive`/`spec.attributes` directly instead, with
 *   this explicit layer, exercising exactly the same production code without that env seam.
 */
export const fakeForgejoLayer = (
  fetchFn: typeof globalThis.fetch,
  creds: Layer.Layer<Credentials> = credentials({ baseUrl: FAKE_BASE, token: FAKE_TOKEN }),
) => Layer.mergeAll(creds, FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, fetchFn));
