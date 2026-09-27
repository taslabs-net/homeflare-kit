/**
 * A minimal in-memory Argo CD REST API for this family's tests — an in-memory `fetch` handed to
 * Effect's real `FetchHttpClient` through its `Fetch` reference, mirroring `../discord/fake-discord.ts`
 * (itself mirroring `../forgejo/fake-forgejo.ts` and `cloudflare/fake-mesh.ts`). Tests exercise
 * distilled's REAL path assembly, JSON encode/decode and status→typed-error matching — nothing
 * about any of that is re-implemented here, only the wire responses a scenario needs.
 *
 * ⛔ TEST-ONLY, AND NO NETWORK. No provider imports this file. The base URL is RFC 2606
 *   `argocd.example.com`, and the token is a placeholder. NO LIVE ARGO CD INSTANCE EXISTS ON THE
 *   ESTATE (2026-09-24) — this is the only server any test in this family talks to.
 */
import { type Credentials, fromToken } from '@distilled.cloud/argocd/Credentials';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';

export const FAKE_BASE = 'https://argocd.example.com';
export const FAKE_TOKEN = 'placeholder-argocd-token';

export type Seen = { readonly method: string; readonly path: string; readonly body: unknown };

/** Argo CD's grpc-gateway `{ code?, message, error? }` failure envelope. */
export const fakeFailure = (status: number, message: string, code?: number) =>
  Response.json({ code, error: message, message }, { status });

/**
 * `route` decides every response; this wrapper only records what was sent and adapts to
 * `globalThis.fetch`'s signature. A test that expects no request at all asserts `seen` is empty.
 */
export const fakeArgocd = (
  route: (method: string, url: URL, body: unknown, callNumber: number) => Response,
) => {
  const seen: Seen[] = [];
  let callNumber = 0;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    const bodyText = await request.clone().text();
    const body: unknown = bodyText === '' ? undefined : JSON.parse(bodyText);
    seen.push({ body, method: request.method, path: `${url.pathname}${url.search}` });
    callNumber += 1;
    return route(request.method, url, body, callNumber);
  }) as typeof globalThis.fetch;
  return { fetch, seen };
};

/**
 * distilled Credentials + the real FetchHttpClient over the fake — `ArgocdOpContext`, what every
 * resource file's exported `spec.fetchLive`/`spec.upsert`/`spec.destroy` needs.
 *
 * ⚠️ NOT PAIRED WITH `handlers` (each resource file's `argocdHandlers(spec)` export). `handlers`
 *   bakes in `CredentialsFromEnv`, which resolves through Effect's `Config` snapshot of
 *   `process.env` — untestable against a fake server without mutating the real environment. So a
 *   test calls `spec.fetchLive`/`spec.upsert`/`spec.destroy` directly, with this explicit layer,
 *   exercising exactly the same production code without that env seam.
 */
export const fakeArgocdLayer = (
  fetchFn: typeof globalThis.fetch,
  creds: Layer.Layer<Credentials> = fromToken({ apiBaseUrl: FAKE_BASE, token: FAKE_TOKEN }),
) => Layer.mergeAll(creds, FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, fetchFn));
