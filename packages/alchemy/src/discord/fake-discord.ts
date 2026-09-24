/**
 * A minimal in-memory Discord REST API for this family's tests — an in-memory `fetch` handed to
 * Effect's real `FetchHttpClient` through its `Fetch` reference, mirroring `../netbox/fake-netbox.ts`
 * (itself mirroring `../forgejo/fake-forgejo.ts` and `cloudflare/fake-mesh.ts`). Tests exercise
 * distilled's REAL path assembly, JSON encode/decode, status→typed-error matching AND its retry
 * policy — nothing about any of that is re-implemented here, only the wire responses a scenario
 * needs, including a `429` with a `Retry-After` header for the bounded-retry test.
 *
 * ⛔ TEST-ONLY, AND NO NETWORK. No provider imports this file. The base URL is RFC 2606
 *   `discord.example.com`, and the token is a placeholder.
 */
import { type Credentials, credentials } from '@distilled.cloud/discord/Credentials';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';

export const FAKE_BASE = 'https://discord.example.com';
export const FAKE_TOKEN = 'placeholder-discord-token';

export type Seen = { readonly method: string; readonly path: string; readonly body: unknown };

/** Discord's `{ code, message }` failure envelope — matching `protocol.ts`'s `errorEnvelope`. */
export const fakeFailure = (
  status: number,
  code: number,
  message: string,
  headers?: Record<string, string>,
) => Response.json({ code, message }, headers === undefined ? { status } : { headers, status });

/** A `429` with `Retry-After` in seconds, Discord's real shape for a rate-limited response. */
export const fakeRateLimited = (retryAfterSeconds: number) =>
  fakeFailure(429, 20028, 'You are being rate limited.', {
    'Retry-After': String(retryAfterSeconds),
  });

/**
 * `route` decides every response; this wrapper only records what was sent and adapts to
 * `globalThis.fetch`'s signature. A test that expects no request at all asserts `seen` is empty.
 */
export const fakeDiscord = (
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
 * distilled Credentials + the real FetchHttpClient over the fake — `DiscordOpContext`, what every
 * resource file's exported `spec.fetchByName`/`spec.upsert`/`spec.destroy` needs.
 *
 * ⚠️ NOT PAIRED WITH `handlers` (each resource file's `discordHandlers(spec)` export). `handlers`
 *   bakes in `CredentialsFromEnv`, which resolves through Effect's `Config` snapshot of
 *   `process.env` — the same seam `../netbox/fake-netbox.ts` documents as untestable against a
 *   fake server. So a test calls `spec.fetchByName`/`spec.upsert`/`spec.destroy` directly, with
 *   this explicit layer, exercising exactly the same production code without that env seam.
 */
export const fakeDiscordLayer = (
  fetchFn: typeof globalThis.fetch,
  creds: Layer.Layer<Credentials> = credentials({ apiBaseUrl: FAKE_BASE, token: FAKE_TOKEN }),
) => Layer.mergeAll(creds, FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, fetchFn));
