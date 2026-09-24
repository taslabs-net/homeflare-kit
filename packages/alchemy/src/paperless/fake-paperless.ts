/**
 * A minimal in-memory Paperless-ngx REST API for this family's tests — an in-memory `fetch`
 * handed to Effect's real `FetchHttpClient` through its `Fetch` reference, mirroring
 * `../netbox/fake-netbox.ts` and `../forgejo/fake-forgejo.ts`. Tests exercise distilled's REAL
 * path assembly, JSON encode/decode and status→typed-error matching (`404` → `NotFound`, `403` →
 * `Forbidden`, `400` → `BadRequest`, …) — nothing about that matching is re-implemented here, only
 * the wire responses and in-memory rows a scenario needs.
 *
 * ⛔ TEST-ONLY, AND NO NETWORK. No provider imports this file. Stores rows in memory for the four
 *   taxonomy collections and answers `name__iexact` the way Django does — case-insensitive, never
 *   collapsing two differently-cased rows into one. Ported from the pre-migration `Bun.serve`
 *   fake: production now goes through `@distilled.cloud/paperless-ngx`'s `CredentialsFromEnv`,
 *   which resolves through Effect `Config` and snapshots `process.env` once (measured in the
 *   forgejo migration, kit PR 180) — a test can no longer point production code at a fake server
 *   by mutating env vars, so this hands an explicit `credentials()` layer instead.
 */
import { type Credentials, credentials } from '@distilled.cloud/paperless-ngx/Credentials';
import type { PaperlessNgxOpContext } from '@distilled.cloud/paperless-ngx/Protocol';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';

export const FAKE_BASE = 'https://paperless.example.com';
export const FAKE_TOKEN = 'placeholder-paperless-token';

export interface Seen {
  readonly method: string;
  readonly path: string;
  readonly body: string;
}

export type Row = Record<string, unknown> & { id: number };

const COLLECTIONS = ['tags', 'document_types', 'storage_paths', 'custom_fields'] as const;
type Collection = (typeof COLLECTIONS)[number];

export interface FakePaperless {
  readonly fetch: typeof globalThis.fetch;
  readonly seen: Seen[];
  readonly rows: (collection: Collection) => readonly Row[];
  /** `undefined` to answer normally; a status to force it once for the NEXT call only. */
  forceStatus: number | undefined;
}

const nextId = (store: readonly Row[]): number =>
  store.length === 0 ? 1 : Math.max(...store.map((r) => r.id)) + 1;

const json = (status: number, body: unknown): Response =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

/**
 * A stateful CRUD router across the four collections — this is what makes it possible to test
 * `matching.ts`'s full create → read-back → PATCH → DELETE lifecycle, not just one canned
 * response per test the way `fakeNetbox`/`fakeForgejo`'s simpler `route` callback does.
 */
export const fakePaperless = (): FakePaperless => {
  const seen: Seen[] = [];
  const store = new Map<Collection, Row[]>(COLLECTIONS.map((c) => [c, []]));
  let forced: number | undefined;

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    const body = await request.text();
    seen.push({ body, method: request.method, path: `${url.pathname}${url.search}` });

    if (forced !== undefined) {
      const status = forced;
      forced = undefined;
      return json(status, { detail: 'injected for the test' });
    }

    const segments = url.pathname.split('/').filter((s) => s !== '');
    // ['api', collection, (id)?]
    const collection = segments[1] as Collection | undefined;
    if (collection === undefined || !COLLECTIONS.includes(collection))
      return json(404, { detail: 'Not found.' });
    const rows = store.get(collection) as Row[];
    const id = segments[2] === undefined ? undefined : Number(segments[2]);

    if (request.method === 'GET' && id === undefined) {
      const filter = url.searchParams.get('name__iexact');
      const matched =
        filter === null
          ? rows
          : rows.filter((r) => String(r['name']).toLowerCase() === filter.toLowerCase());
      return json(200, { count: matched.length, next: null, previous: null, results: matched });
    }
    if (request.method === 'POST' && id === undefined) {
      const row: Row = { id: nextId(rows), ...(JSON.parse(body) as Record<string, unknown>) };
      rows.push(row);
      return json(201, row);
    }
    const found = id === undefined ? undefined : rows.find((r) => r.id === id);
    if (found === undefined) return json(404, { detail: 'Not found.' });
    if (request.method === 'GET') return json(200, found);
    if (request.method === 'PATCH') {
      Object.assign(found, JSON.parse(body) as Record<string, unknown>);
      return json(200, found);
    }
    if (request.method === 'DELETE') {
      store.set(
        collection,
        rows.filter((r) => r.id !== id),
      );
      return new Response(null, { status: 204 });
    }
    return json(405, { detail: 'method not allowed' });
  }) as typeof globalThis.fetch;

  return {
    fetch,
    get forceStatus() {
      return forced;
    },
    set forceStatus(value: number | undefined) {
      forced = value;
    },
    rows: (collection) => store.get(collection) ?? [],
    seen,
  };
};

/**
 * distilled Credentials + the real FetchHttpClient over the fake — `PaperlessNgxOpContext`, what
 * `matchingOperations(spec)` (matching.ts, unwrapped — not `matchingHandlers`, which bakes in
 * `CredentialsFromEnv` and so cannot be pointed at a fake server, per this file's own header)
 * needs to run against a fake.
 */
export const fakePaperlessLayer = (
  fetchFn: typeof globalThis.fetch,
  creds: Layer.Layer<Credentials> = credentials({ baseUrl: FAKE_BASE, token: FAKE_TOKEN }),
) => Layer.mergeAll(creds, FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, fetchFn));

export const run = <A, E>(
  effect: Effect.Effect<A, E, PaperlessNgxOpContext>,
  fetchFn: typeof globalThis.fetch,
) => Effect.runPromise(effect.pipe(Effect.provide(fakePaperlessLayer(fetchFn))));

export const runFailure = <A, E>(
  effect: Effect.Effect<A, E, PaperlessNgxOpContext>,
  fetchFn: typeof globalThis.fetch,
) => Effect.runPromise(Effect.flip(effect).pipe(Effect.provide(fakePaperlessLayer(fetchFn))));
