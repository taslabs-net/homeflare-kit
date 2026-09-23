/**
 * A fake Paperless-ngx for the tests beside it — `Bun.serve` on an ephemeral 127.0.0.1 port, the
 * same shape `../openbao/fake-bao.ts` and `../caddy/fake-caddy.ts` use.
 *
 * ⛔ TEST-ONLY. No provider imports this file. It stores rows in memory for exactly the four
 *   taxonomy collections and answers `name__iexact` the way Django does — case-insensitive,
 *   never collapsing two differently-cased rows into one.
 */
import * as Effect from 'effect/Effect';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import type { PaperlessRequirements } from './client.ts';
import { type PaperlessCredentialsError, environmentLayer } from './credentials.ts';
import type { PaperlessError } from './errors.ts';

export const FAKE_TOKEN = 'fake-token-not-real';

export interface Seen {
  readonly method: string;
  readonly path: string;
  readonly headers: Headers;
  readonly body: string;
}

export type Row = Record<string, unknown> & { id: number };

const COLLECTIONS = ['tags', 'document_types', 'storage_paths', 'custom_fields'] as const;

export interface FakePaperless {
  readonly url: string;
  readonly seen: Seen[];
  readonly rows: (collection: (typeof COLLECTIONS)[number]) => readonly Row[];
  /** `undefined` to answer normally; a status to force it once per subsequent call. */
  forceStatus: number | undefined;
  stop(): void;
}

const nextId = (store: Row[]): number =>
  store.length === 0 ? 1 : Math.max(...store.map((r) => r.id)) + 1;

export const fakePaperless = (): FakePaperless => {
  const seen: Seen[] = [];
  const store = new Map<(typeof COLLECTIONS)[number], Row[]>(COLLECTIONS.map((c) => [c, []]));
  let forced: number | undefined;

  const fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const body = await request.text();
    seen.push({
      body,
      headers: request.headers,
      method: request.method,
      path: `${url.pathname}${url.search}`,
    });

    const token = request.headers.get('Authorization');
    if (token !== `Token ${FAKE_TOKEN}`) return json(401, { detail: 'Invalid token.' });
    if (forced !== undefined) {
      const status = forced;
      forced = undefined;
      return json(status, { detail: 'injected for the test' });
    }

    const segments = url.pathname.split('/').filter((s) => s !== '');
    // ['api', collection, (id)?]
    const collection = segments[1] as (typeof COLLECTIONS)[number] | undefined;
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
  };

  const server = Bun.serve({ fetch, hostname: '127.0.0.1', port: 0 });
  return {
    get forceStatus() {
      return forced;
    },
    set forceStatus(value: number | undefined) {
      forced = value;
    },
    rows: (collection) => store.get(collection) ?? [],
    seen,
    stop: () => void server.stop(true),
    url: server.url.origin,
  };
};

const json = (status: number, body: unknown): Response =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

/** Run `body` against a fresh fake, `PAPERLESS_URL`/`PAPERLESS_TOKEN` set only for its duration. */
export const withFake = async (body: (fake: FakePaperless) => Promise<void>): Promise<void> => {
  const fake = fakePaperless();
  const savedUrl = process.env['PAPERLESS_URL'];
  const savedToken = process.env['PAPERLESS_TOKEN'];
  process.env['PAPERLESS_URL'] = fake.url;
  process.env['PAPERLESS_TOKEN'] = FAKE_TOKEN;
  try {
    await body(fake);
  } finally {
    fake.stop();
    if (savedUrl === undefined) delete process.env['PAPERLESS_URL'];
    else process.env['PAPERLESS_URL'] = savedUrl;
    if (savedToken === undefined) delete process.env['PAPERLESS_TOKEN'];
    else process.env['PAPERLESS_TOKEN'] = savedToken;
  }
};

/** Run an effect through the real `FetchHttpClient` and the real environment credentials layer. */
export const run = <A>(
  effect: Effect.Effect<A, PaperlessError | PaperlessCredentialsError, PaperlessRequirements>,
) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(FetchHttpClient.layer), Effect.provide(environmentLayer)),
  );

export const runFailure = <A>(
  effect: Effect.Effect<A, PaperlessError | PaperlessCredentialsError, PaperlessRequirements>,
) =>
  Effect.runPromise(
    Effect.flip(effect).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(environmentLayer),
    ),
  );
