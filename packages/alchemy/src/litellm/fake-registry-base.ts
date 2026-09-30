/**
 * The shared skeleton of the registry fakes (`fake-team-litellm.ts`, `fake-access-group-litellm.ts`,
 * `fake-toolset-litellm.ts`, `fake-policy-litellm.ts`, `fake-tool-litellm.ts`) — TEST ONLY, never
 * imported by `index.ts`.
 *
 * ★ Like `fake-litellm.ts` this is a `fetch` function handed to Effect's real `FetchHttpClient`
 *   through its `Fetch` reference, so a test exercises distilled's REAL path assembly, JSON encoding
 *   and status-to-error matching. Only the wire responses a scenario needs are written by each fake.
 * ★ ONE FAKE PER ROUTE FAMILY, each small, and this file is the part they would otherwise repeat:
 *   the bearer check, the request log, and the body log a test reads to see what was SENT.
 * ⚠️ EVERY FAKE'S ANSWERS ARE ITS OWN CHOICE UNLESS ITS HEADER SAYS "MEASURED": shapes come from the
 *   generated 1.103.0 schema and from reading the 1.103.0 source, never from a live proxy. A test that
 *   leans on a choice says so.
 * ⚠️ NEVER ANSWER 5xx. The SDK retries 5xx with backoff, which would cost a test tens of seconds for
 *   nothing; a failing write is a 400/403/409 here.
 * ★ `FAKE-*` VALUES ONLY.
 */
import type { Row } from './registry-support.ts';

/** One request that reached a fake. */
export interface FakeRequest {
  readonly method: string;
  readonly path: string;
}

/** What every registry fake exposes besides its own rows. */
export interface FakeRecord {
  readonly fetch: typeof globalThis.fetch;
  readonly requests: () => readonly FakeRequest[];
  /** The JSON bodies of every request that carried one, in order (`POST`/`PUT`/`PATCH`/`DELETE`). */
  readonly bodies: () => readonly Row[];
}

export const FAKE_KEY = 'sk-test-master';

export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });

/** A success with no body, as `DELETE` answers 202/204 on several routes. */
export const empty = (status: number): Response => new Response(null, { status });

export interface Call {
  readonly request: Request;
  readonly url: URL;
  /** The parsed JSON body, or `{}` when the request had none. */
  readonly body: Row;
}

export const recordingFetch = (
  masterKey: string,
  route: (call: Call) => Response | Promise<Response>,
): FakeRecord => {
  const requests: FakeRequest[] = [];
  const bodies: Row[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    requests.push({ method: request.method, path: `${url.pathname}${url.search}` });
    if (request.headers.get('authorization') !== `Bearer ${masterKey}`) {
      return json(401, { detail: 'invalid api key' });
    }
    const text = request.method === 'GET' ? '' : await request.text();
    const body = text.trim() === '' ? {} : (JSON.parse(text) as Row);
    if (text.trim() !== '') bodies.push(body);
    return route({ body, request, url });
  }) as typeof globalThis.fetch;
  return { bodies: () => [...bodies], fetch, requests: () => [...requests] };
};
