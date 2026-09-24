/**
 * A minimal in-memory OPNsense API for this family's tests — an in-memory `fetch` handed to
 * Effect's real `FetchHttpClient` through its `Fetch` reference, mirroring `../discord/fake-discord.ts`
 * (itself mirroring `../netbox/fake-netbox.ts`). Tests exercise distilled's REAL path assembly,
 * JSON encode/decode and Basic-auth header construction — nothing about any of that is
 * re-implemented here, only the wire responses a scenario needs.
 *
 * ⛔ TEST-ONLY, AND NO NETWORK. No provider imports this file. The base URL is RFC 2606
 *   `opnsense.example.com`, and the key/secret are placeholders — never the edge's real ones,
 *   which this task has no access to and must not look for (see policy.ts's header).
 */
import { type Credentials, credentials } from '@distilled.cloud/opnsense/Credentials';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';

export const FAKE_BASE = 'https://opnsense.example.com';
export const FAKE_KEY = 'placeholder-opnsense-key';
export const FAKE_SECRET = 'placeholder-opnsense-secret';

export type Seen = { readonly method: string; readonly path: string; readonly body: unknown };

export const fakeFailure = (status: number, body: unknown) => Response.json(body, { status });

/**
 * `route` decides every response; this wrapper only records what was sent and adapts to
 * `globalThis.fetch`'s signature. A test that expects no request at all asserts `seen` is empty.
 */
export const fakeOpnsense = (
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
 * ★ FAILS THE TEST ITSELF ON ANY NON-GET REQUEST — the "no SDK write operation is reachable"
 *   proof `write-refusal.test.ts` and every resource's own test build on. `respond` only ever
 *   sees a GET, so it never has to branch on method.
 */
export const getOnlyOrFail = (respond: (url: URL, callNumber: number) => Response) =>
  fakeOpnsense((method, url, _body, callNumber) => {
    if (method !== 'GET') {
      throw new Error(
        `fake-opnsense: unexpected ${method} ${url.pathname} — Opnsense.Firewall.* may never ` +
          'write (policy.ts); this call should not have happened.',
      );
    }
    return respond(url, callNumber);
  });

/**
 * distilled Credentials + the real FetchHttpClient over the fake — `OpnsenseOpContext`, what
 * every resource file's exported `spec.fetchLive` needs.
 *
 * ⚠️ NOT PAIRED WITH `handlers` (each resource file's `opnsenseHandlers(spec)` export). `handlers`
 *   bakes in `CredentialsFromEnv`, which resolves through Effect's `Config` snapshot of
 *   `process.env` — untestable against a fake server without setting real env vars a parallel
 *   test run could race on. So a test calls `spec.fetchLive` (or `opnsenseOperations(spec)`)
 *   directly, with this explicit layer, exercising exactly the same production code.
 */
export const fakeOpnsenseLayer = (
  fetchFn: typeof globalThis.fetch,
  creds: Layer.Layer<Credentials> = credentials({
    apiKey: FAKE_KEY,
    apiSecret: FAKE_SECRET,
    baseUrl: FAKE_BASE,
  }),
) => Layer.mergeAll(creds, FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, fetchFn));
