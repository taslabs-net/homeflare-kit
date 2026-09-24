/**
 * A minimal in-memory Directory API for this family's tests — an in-memory `fetch` handed to
 * Effect's real `FetchHttpClient` through its `Fetch` reference, mirroring
 * `../netbox/fake-netbox.ts` and `../forgejo/fake-forgejo.ts`. Tests exercise distilled's REAL
 * path assembly, JSON encode/decode and status→typed-error matching (`404` → `NotFound`, `403` →
 * `Forbidden`, …) — nothing about that matching is re-implemented here, only the wire responses a
 * scenario needs.
 *
 * ⛔ TEST-ONLY, AND NO NETWORK. The token is a placeholder that is never a real bearer token, and
 *   no request this fake answers ever leaves the process.
 */
import { type Credentials, fromAccessToken } from '@distilled.cloud/google-workspace/Credentials';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';

export const FAKE_TOKEN = 'placeholder-google-workspace-token';

export type Seen = { readonly method: string; readonly path: string };

/** Google's own `{ error: { code, message, status } }` failure envelope — matching protocol.ts. */
export const fakeFailure = (status: number, message: string, googleStatus: string) =>
  Response.json({ error: { code: status, message, status: googleStatus } }, { status });

/**
 * `route` decides every response; this wrapper only records what was sent and adapts to
 * `globalThis.fetch`'s signature. A test that expects no request at all asserts `seen` is empty.
 */
export const fakeGoogleWorkspace = (route: (method: string, url: URL) => Response) => {
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
 * distilled Credentials + the real FetchHttpClient over the fake — `GoogleWorkspaceOpContext`,
 * what every resource file's exported `spec.fetchLive` needs.
 *
 * ⚠️ NOT PAIRED WITH `handlers` (each resource file's `googleWorkspaceHandlers(spec)` export).
 *   `handlers` bakes in `CredentialsFromEnv`, which resolves `GOOGLE_ACCESS_TOKEN` through
 *   Effect's `Config` — whose default provider snapshots `process.env` once and never re-reads it
 *   (measured in the forgejo migration, kit PR 180). So a test cannot point `handlers` at a fake
 *   server; it calls `spec.fetchLive`/`spec.attributes` directly instead, with this explicit
 *   layer, exercising exactly the same production code without that env seam.
 */
export const fakeGoogleWorkspaceLayer = (
  fetchFn: typeof globalThis.fetch,
  creds: Layer.Layer<Credentials> = fromAccessToken({ accessToken: FAKE_TOKEN }),
) => Layer.mergeAll(creds, FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, fetchFn));
