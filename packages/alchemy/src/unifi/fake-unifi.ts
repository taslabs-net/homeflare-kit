/**
 * A minimal in-memory UniFi Network API for this family's tests — an in-memory `fetch` handed to
 * Effect's real `FetchHttpClient` through its `Fetch` reference, mirroring `../netbox/fake-netbox.ts`
 * (itself mirroring `../forgejo/fake-forgejo.ts`). Tests exercise distilled's REAL path assembly,
 * JSON encode/decode and status→typed-error matching — nothing about that matching is
 * re-implemented here, only the wire responses a scenario needs.
 *
 * ⛔ TEST-ONLY, AND NO NETWORK. No provider imports this file. The base URL is RFC 2606
 *   `unifi.example.com` and the key is a placeholder — never a real console address: a cloud
 *   connector's base URL embeds the account's Console ID, which must never appear in this repo
 *   (`docs/unifi.md`).
 */
import { type Credentials, credentials } from '@distilled.cloud/unifi-network/Credentials';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';

export const FAKE_BASE = 'https://unifi.example.com/proxy/network/integration';
export const FAKE_KEY = 'placeholder-unifi-key';

export type Seen = { readonly method: string; readonly path: string };

/** No documented failure envelope (see `protocol.ts`) — plain text is all a failure needs. */
export const fakeFailure = (status: number, detail: string) => new Response(detail, { status });

/**
 * `route` decides every response; this wrapper only records what was sent and adapts to
 * `globalThis.fetch`'s signature.
 *
 * ★ THE WRITE-REFUSAL PROOF USES `seen` DIRECTLY, NOT A THROWING ROUTE. `resource.test.ts`'s
 *   "no SDK write operation is reachable" test asserts `seen.every(s => s.method === 'GET')`
 *   after driving every handler — a request this family's engine was never supposed to send
 *   shows up in `seen` as a fact, rather than depending on an exception surviving Effect's own
 *   error handling on its way back out of a fake `fetch`.
 */
export const fakeUnifi = (route: (method: string, url: URL) => Response) => {
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
 * distilled Credentials + the real FetchHttpClient over the fake — `UnifiNetworkOpContext`, what
 * every resource file's exported `spec.fetchLive` needs.
 *
 * ⚠️ NOT PAIRED WITH `handlers`. `handlers` (each resource file's `unifiHandlers(spec)` export)
 *   bakes in `CredentialsFromEnv`, which resolves `UNIFI_NETWORK_API_KEY`/`_API_BASE_URL` through
 *   Effect's `Config` — whose default provider snapshots `process.env` once and never re-reads it
 *   (the same seam `netbox/fake-netbox.ts` documents). Tests call `spec.fetchLive`/`spec.attributes`
 *   directly instead, with this explicit layer.
 */
export const fakeUnifiLayer = (
  fetchFn: typeof globalThis.fetch,
  creds: Layer.Layer<Credentials> = credentials({ apiBaseUrl: FAKE_BASE, apiKey: FAKE_KEY }),
) => Layer.mergeAll(creds, FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, fetchFn));
