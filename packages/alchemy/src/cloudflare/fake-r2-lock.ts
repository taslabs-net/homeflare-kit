/**
 * A fake Cloudflare R2 bucket-lock API for r2-bucket-lock.test.ts — an in-memory `fetch` handed to
 * Effect's real FetchHttpClient through its `Fetch` reference, so the tests exercise distilled's
 * real path assembly, header encoding, envelope decoding and error matching. Same idiom as
 * fake-mesh.ts, for the route `GET`/`PUT /accounts/<FAKE_ACCOUNT>/r2/buckets/<name>/lock`.
 *
 * ⛔ TEST-ONLY, AND NO NETWORK. No provider imports this file. The base URL is RFC 2606
 *   `api.example.com`, and any request outside that route throws, so a mis-wired test fails
 *   instead of reaching a real API.
 * ★ `existingBuckets` MODELS THE VENDOR'S OWN DISTINCTION. A bucket not in the set answers
 *   `NoSuchBucket` (code 10006) on both verbs, matching the 404 the doc comment in
 *   r2-bucket-lock.ts measured. A bucket in the set with no rules answers `{}` on GET, matching
 *   "never locked" — both collapse to "absent" in `readLock`, but the fake keeps them distinct so
 *   a test can put a bucket in either state on purpose.
 * ★ `onRoute` OVERRIDES ONE REQUEST. A test uses it to answer a request with an arbitrary
 *   `Response` — a non-404 status carrying code 10006 (proves matching is by code, not status), or
 *   a different tagged error entirely (`InvalidRoute`, code 7003) to prove it does NOT fall into
 *   `readLock`'s `NoSuchBucket` catch.
 */
import { type Credentials, fromApiToken } from '@distilled.cloud/cloudflare/Credentials';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import type { R2LockRule } from './lock-rules.ts';

export const FAKE_BASE = 'https://api.example.com/client/v4';
export const FAKE_ACCOUNT = '00000000000000000000000000000002';
/** ⚠️ A placeholder, not a credential. */
export const FAKE_API_TOKEN = 'placeholder-api-token';

export type Seen = {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
};

const ok = (result: unknown) => Response.json({ success: true, errors: [], messages: [], result });

export const fakeFailure = (status: number, code: number, message: string) =>
  Response.json(
    { success: false, errors: [{ code, message }], messages: [], result: null },
    { status },
  );

/** The response `NoSuchBucket` matches: code 10006, conventionally at 404. */
export const noSuchBucket = (status = 404) =>
  fakeFailure(status, 10006, 'The specified bucket does not exist.');

export type FakeOptions = {
  /** Buckets the account has. Any other name is `NoSuchBucket` on both GET and PUT. */
  readonly existingBuckets?: readonly string[];
  /** Override one request's response. `undefined` falls through to the default route. */
  readonly onRoute?: (method: string, bucketName: string) => Response | undefined;
};

export const fakeR2Lock = (options: FakeOptions = {}) => {
  const existing = new Set(options.existingBuckets ?? []);
  const locks = new Map<string, readonly R2LockRule[]>();
  const seen: Seen[] = [];

  const route = (method: string, url: URL, body: Record<string, unknown>): Response => {
    const prefix = `/client/v4/accounts/${FAKE_ACCOUNT}/r2/buckets/`;
    if (url.host !== 'api.example.com' || !url.pathname.startsWith(prefix)) {
      throw new Error(`fake-r2-lock: unexpected request ${method} ${url.href}`);
    }
    const rest = url.pathname.slice(prefix.length).split('/');
    const bucketName = rest[0];
    if (bucketName === undefined || rest[1] !== 'lock' || rest.length !== 2) {
      throw new Error(`fake-r2-lock: unexpected path ${url.pathname}`);
    }
    const override = options.onRoute?.(method, bucketName);
    if (override !== undefined) return override;
    if (!existing.has(bucketName)) return noSuchBucket();
    if (method === 'GET') return ok({ rules: locks.get(bucketName) ?? [] });
    if (method === 'PUT') {
      const rules = (body['rules'] as readonly R2LockRule[] | undefined) ?? [];
      if (rules.length === 0) locks.delete(bucketName);
      else locks.set(bucketName, rules);
      return ok({});
    }
    throw new Error(`fake-r2-lock: unexpected ${method} ${url.pathname}`);
  };

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    const text = await request.text();
    const body = text.length === 0 ? {} : (JSON.parse(text) as Record<string, unknown>);
    seen.push({
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    });
    return route(request.method, url, body);
  }) as typeof globalThis.fetch;

  return { existing, fetch, locks, seen };
};

export type FakeR2Lock = ReturnType<typeof fakeR2Lock>;

/** distilled Credentials + the real FetchHttpClient over the fake — `CloudflareOpContext`. */
export const fakeR2LockLayer = (
  fake: FakeR2Lock,
  credentials: Layer.Layer<Credentials> = fromApiToken({
    apiToken: FAKE_API_TOKEN,
    apiBaseUrl: FAKE_BASE,
  }),
) =>
  Layer.mergeAll(
    credentials,
    FetchHttpClient.layer,
    Layer.succeed(FetchHttpClient.Fetch, fake.fetch),
  );

/** The writes the fake saw, in order: `['PUT', 'GET', …]`. */
export const writes = (fake: FakeR2Lock) =>
  fake.seen.filter((s) => s.method !== 'GET').map((s) => s.method);
