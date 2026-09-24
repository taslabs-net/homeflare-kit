/**
 * A minimal in-memory Argo CD HTTP API for this family's tests — an in-memory `fetch` handed to
 * Effect's real `FetchHttpClient` through its `Fetch` reference, mirroring
 * `../forgejo/fake-forgejo.ts` and `../grafana/fake-grafana.ts`. Tests exercise distilled's REAL
 * path assembly, JSON encode/decode and status→typed-error matching (`404` → `NotFound` via
 * core `HTTP_STATUS_MAP`) — nothing about that matching is re-implemented here.
 *
 * ⛔ TEST-ONLY, AND NO NETWORK. No provider imports this file. The base URL is RFC 2606
 *   `argocd.example.com`, and the token is a placeholder.
 */
import { type Credentials, fromToken } from '@distilled.cloud/argocd/Credentials';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';

export const FAKE_BASE = 'https://argocd.example.com';
export const FAKE_TOKEN = 'placeholder-argocd-token';

export type Seen = { readonly method: string; readonly path: string };

/** grpc-gateway `{ code?, message, error? }` — matching `protocol.ts`'s envelope note. */
export const fakeFailure = (status: number, message: string) =>
  Response.json({ code: status, error: message, message }, { status });

/**
 * `route` decides every response. `bodies` is a parallel array (index-matched to `seen`) so
 * existing `expect(fake.seen).toEqual([{method, path}])` stays exact — a test that cares what
 * was sent reads `bodies[n]`.
 */
export const fakeArgocd = (route: (method: string, url: URL, body: unknown) => Response) => {
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
  return { bodies, fetch, seen };
};

/**
 * Distilled `fromToken` + the real `FetchHttpClient` over the fake — `ArgocdOpContext`.
 * Never touches `process.env`: `argocdCredentials` reads `tokenEnv` fresh per call, and
 * Effect's default `Config` provider snapshots the environment (measured for Forgejo, 2026-09-23).
 */
export const fakeArgocdLayer = (
  fetchFn: typeof globalThis.fetch,
  creds: Layer.Layer<Credentials> = fromToken({ apiBaseUrl: FAKE_BASE, token: FAKE_TOKEN }),
) => Layer.mergeAll(creds, FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, fetchFn));
