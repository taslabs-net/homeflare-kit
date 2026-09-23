/**
 * One authenticated call to the NetBox REST API at `/api`.
 *
 * ⚠️ `Authorization: Token <value>`, NOT `Bearer`. NetBox is Django REST Framework using DRF's own
 *   `TokenAuthentication`. MEASURED on this estate's own instance while it was up: `Bearer`
 *   returns 401 and `Token` returns 200. ⛔ A wrong scheme and a wrong credential are
 *   indistinguishable in the response, which is why this is written down rather than inferred.
 *
 * ⚠️ NETBOX DOES NOT WRAP A DETAIL RESPONSE THE WAY PVE DOES — a GET of one object returns the
 *   object. A LIST, however, IS wrapped: `{count, next, previous, results: [...]}`. A caller that
 *   treats a list like a detail sees `undefined` and calls a healthy object absent, which plans a
 *   create over something that already exists.
 *
 * ⛔ THE TOKEN IS NEVER A PROP. It is read from `NETBOX_TOKEN` at call time only. Alchemy persists
 *   attributes unencrypted; nothing stored here may be a credential.
 */
import * as Effect from 'effect/Effect';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';

const PATH_PREFIX = '/api';

/**
 * The instance, from `NETBOX_URL`. Trailing slash stripped.
 *
 * ⛔ NO DEFAULT HOSTNAME AND NO DEFAULT PORT. A published package that fell back to a loopback
 *   address would let a consumer who forgot the variable watch every call fail against a machine
 *   that is not theirs, instead of being told which variable is missing.
 * ⚠️ Read at CALL time, never at module scope — a value captured at import is pinned to whatever
 *   the first isolate saw.
 */
export const apiBase = (): string => {
  const raw = process.env['NETBOX_URL'];
  if (raw === undefined || raw.trim() === '') {
    throw new Error(
      'NETBOX_URL is not set. Point it at your NetBox instance, e.g. https://netbox.example.com',
    );
  }
  return raw.trim().replace(/\/$/, '');
};

export class NetboxError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    detail: string,
  ) {
    super(`NetBox ${method} ${path} -> ${String(status)}: ${detail}`);
    this.name = 'NetboxError';
  }
}

const token = (): Effect.Effect<string, NetboxError> =>
  Effect.gen(function* () {
    const raw = process.env['NETBOX_TOKEN'];
    if (raw === undefined || raw.trim() === '') {
      return yield* Effect.fail(
        new NetboxError(
          0,
          'GET',
          '',
          'NETBOX_TOKEN is unset. Mint a scoped token and export it — never store it in Alchemy props.',
        ),
      );
    }
    return raw.trim();
  });

/** A NetBox list response. ⚠️ Paginated: `next` is a URL, not a cursor to guess at. */
export interface NetboxList<T> {
  readonly count: number;
  readonly next: string | null;
  readonly results: readonly T[];
}

export type NetboxRow = Record<string, unknown>;

/** One JSON call. Returns the parsed body, or `undefined` when the response is empty (DELETE). */
export const netbox = <T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    const credential = yield* token();
    const url = `${apiBase()}${PATH_PREFIX}/${path.replace(/^\//, '')}`;
    /**
     * ★ THROUGH `HttpClient`, NOT THE GLOBAL `fetch` — the idiom Alchemy's own providers follow.
     *   It buys a typed error channel, interruption when a plan is cancelled, the runtime's
     *   tracing, and a client a test can replace without monkey-patching a global.
     */
    const client = yield* HttpClient.HttpClient;
    /**
     * ⛔ THE CONTENT TYPE GOES ON `bodyText`, NOT IN THE HEADER MAP. `bodyText(s)` with no second
     *   argument sets `text/plain` and OVERWRITES a `Content-Type` set by `setHeaders`, because it
     *   is piped afterwards. That shipped `@homeflare/alchemy/forgejo` unable to write at all —
     *   every create and update in the package, broken identically, for as long as the only
     *   credential on the shelf was read-only and so never reached a request body.
     */
    const request = HttpClientRequest.make(method)(url).pipe(
      HttpClientRequest.setHeaders({
        Accept: 'application/json',
        Authorization: `Token ${credential}`,
      }),
      body === undefined
        ? (self) => self
        : HttpClientRequest.bodyText(JSON.stringify(body), 'application/json'),
    );
    const response = yield* client
      .execute(request)
      .pipe(Effect.mapError((cause) => new NetboxError(0, method, path, String(cause))));
    // ⛔ Status first, body once — a NetBox error body is JSON but a reverse proxy's 502 is not.
    //   ⚠️ AND A 502 IS THE EXPECTED SYMPTOM WHEN NETBOX IS DOWN BUT ITS FRONT DOOR IS UP, which
    //   is the state the reference instance has been in since 2026-09-14. Folding it to "absent"
    //   would plan a create for every object that already exists.
    if (response.status < 200 || response.status >= 300) {
      const detail = yield* response.text.pipe(Effect.orElseSucceed(() => ''));
      return yield* Effect.fail(
        new NetboxError(response.status, method, path, detail.slice(0, 300)),
      );
    }
    // ⚠️ 204 AND AN EMPTY BODY ARE REAL: a DELETE answers no content, and parsing an empty body
    //   throws. Read the text once and parse only when there is something to parse.
    const text = yield* response.text.pipe(
      Effect.mapError((cause) => new NetboxError(0, method, path, String(cause))),
    );
    return (text === '' ? undefined : JSON.parse(text)) as T;
  });

/**
 * The single row a filtered list returns, or `undefined`.
 *
 * ⛔ MORE THAN ONE MATCH IS A DEFECT, NOT A REASON TO TAKE THE FIRST. A `locate` filter that is
 *   not unique would let adopt bind to whichever row NetBox happened to order first, and the next
 *   plan would bind to the other one and report drift that is not there.
 */
export const soleMatch = <T>(rows: readonly T[], describe: string): T | undefined => {
  if (rows.length > 1) {
    throw new Error(
      `${describe} matched ${String(rows.length)} NetBox objects. An object's identity must be ` +
        'unique; narrow it (the VRF, the site, the tenant) rather than taking the first row.',
    );
  }
  return rows[0];
};
