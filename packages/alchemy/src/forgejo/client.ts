/**
 * One authenticated call to the Forgejo (Gitea) API at `/api/v1`.
 *
 * ★ PLAIN `fetch`, NO TLS ESCAPE HATCH — your Forgejo host serves a real certificate on :443,
 *   and the local daemon on :3000 is loopback. There is no `rejectUnauthorized` switch to leave
 *   on by accident elsewhere.
 *
 * ⚠️ GITEA DOES NOT WRAP ANSWERS IN `{"data": ...}` THE WAY PVE DOES. MEASURED 2026-09-13 on
 *   the live daemon: `GET /api/v1/version` returns `{"version":"16.0.3"}`; `GET /api/v1/user`
 *   returns the user object; `GET /api/v1/orgs/HomeFlare/repos` returns a JSON array. A caller
 *   that unwraps a non-existent envelope sees `undefined` and calls a healthy object "absent".
 *
 * ⛔ THE TOKEN IS NEVER A PROP. Read `FORGEJO_TOKEN` from the environment at call time only.
 *   Alchemy persists attributes unencrypted and this estate's state store is Postgres dumped
 *   nightly — nothing stored may be a credential.
 */
import * as Effect from 'effect/Effect';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';

const PATH_PREFIX = '/api/v1';

/**
 * The Forgejo instance, from `FORGEJO_URL`. Trailing slash stripped.
 *
 * ⛔ NO DEFAULT HOSTNAME. This used to fall back to the author's own instance, which is
 *   fine inside one estate and wrong in a published package: a consumer who forgets the
 *   variable would silently point at someone else's server rather than being told.
 * ⚠️ Read at CALL time, never at module scope — a value captured at import is pinned to
 *   whatever the first isolate saw.
 */
export const apiBase = (): string => {
  const raw = process.env['FORGEJO_URL'];
  if (raw === undefined || raw.trim() === '') {
    throw new Error(
      'FORGEJO_URL is not set. Point it at your Forgejo instance, e.g. https://git.example.com',
    );
  }
  return raw.trim().replace(/\/$/, '');
};

const token = (): Effect.Effect<string, ForgejoError> =>
  Effect.gen(function* () {
    const raw = process.env['FORGEJO_TOKEN'];
    if (raw === undefined || raw.trim() === '') {
      return yield* Effect.fail(
        new ForgejoError(
          0,
          'GET',
          '',
          'FORGEJO_TOKEN is unset. Mint a scoped token and export it — never store it in Alchemy props.',
        ),
      );
    }
    return raw.trim();
  });

export class ForgejoError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    detail: string,
  ) {
    super(`Forgejo ${method} ${path} -> ${String(status)}: ${detail}`);
    this.name = 'ForgejoError';
  }
}

/**
 * ⚠️ `Authorization: token <value>`, NOT `Bearer`. Gitea docs and MEASURED behaviour on this
 *   estate: Bearer is treated as OAuth2 and rejected; `token` is the documented API-key form.
 */
const authorization = (value: string) => ({ Authorization: `token ${value}` });

/** One JSON call. Returns the parsed body, or `undefined` when the response is empty (DELETE). */
export const forgejo = <T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    const credential = yield* token();
    const url = `${apiBase()}${PATH_PREFIX}/${path.replace(/^\//, '')}`;
    /**
     * ★ THROUGH `HttpClient`, NOT THE GLOBAL `fetch` — the idiom Alchemy's own providers follow
     *   (src/Hetzner/Providers.ts builds on `FetchHttpClient.layer`; there is no bare fetch in its
     *   Docker, Kubernetes or GitHub providers). It buys a typed error channel, interruption when
     *   a plan is cancelled, the runtime's tracing, and a client a test can replace without
     *   monkey-patching a global. house/proxmox/src/resource.ts carries the same note.
     */
    const client = yield* HttpClient.HttpClient;
    /**
     * ⛔ THE CONTENT TYPE GOES ON `bodyText`, NOT IN THE HEADER MAP, AND PUTTING IT IN BOTH IS HOW
     *   THIS PACKAGE SHIPPED UNABLE TO WRITE AT ALL.
     *
     * 🔴 THE BUG, MEASURED THE FIRST TIME A WRITE WAS EVER ATTEMPTED. The header map DID carry
     *   `Content-Type: application/json` — and `bodyText(s)` with no second argument sets
     *   `text/plain` and OVERWRITES it, because it is piped AFTER `setHeaders`. Forgejo answered
     *       422 {"message":"[]: Unsupported Content-Type"}
     *   on `PATCH orgs/homeflare/labels/1`. Every create and every update in every family here was
     *   broken, identically, from the day the client was written.
     *
     * ⛔ NOTHING CAUGHT IT BECAUSE NOTHING HAD EVER WRITTEN. The only credential on the shelf was
     *   `mcp-read`, which answers 403 before a request body is ever parsed — so read, adopt, diff
     *   and plan all worked perfectly and the write path had literally never executed. A provider
     *   that has never performed its own writes is not a tested provider, whatever the plan says.
     *
     * ⚠️ `bodyJsonUnsafe` WOULD ALSO WORK. `bodyText` with an explicit type is used instead
     *   because it makes the content type visible at the call site, which is the thing that was
     *   invisible before.
     */
    const request = HttpClientRequest.make(method)(url).pipe(
      HttpClientRequest.setHeaders({ ...authorization(credential), Accept: 'application/json' }),
      body === undefined
        ? (self) => self
        : HttpClientRequest.bodyText(JSON.stringify(body), 'application/json'),
    );
    const response = yield* client
      .execute(request)
      .pipe(Effect.mapError((cause) => new ForgejoError(0, method, path, String(cause))));
    // ⛔ Status first, body once — a Gitea error body is JSON but a proxy's 502 is not.
    if (response.status < 200 || response.status >= 300) {
      const detail = yield* response.text.pipe(Effect.orElseSucceed(() => ''));
      return yield* Effect.fail(
        new ForgejoError(response.status, method, path, detail.slice(0, 300)),
      );
    }
    // ⚠️ 204 AND AN EMPTY BODY ARE REAL: a label DELETE answers no content, and `json` on an empty
    //   body fails. Read text once and parse only when there is something to parse.
    const text = yield* response.text.pipe(
      Effect.mapError((cause) => new ForgejoError(0, method, path, String(cause))),
    );
    // ⚠️ PUT/DELETE on actions secrets and hooks often answer 201/204 with no body — same trap as DELETE.
    return (text === '' ? undefined : JSON.parse(text)) as T;
  });
