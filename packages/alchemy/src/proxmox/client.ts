/**
 * One authenticated call to the Proxmox VE API.
 *
 * ★ PLAIN `fetch`, NO TLS ESCAPE HATCH, AND THAT IS A MEASURED CHOICE RATHER THAN AN OMISSION.
 *   Proxmox is usually met with `curl -k` because a fresh install serves its own self-signed
 *   certificate — I reached for `-k` myself before checking. This cluster serves a real Let's
 *   Encrypt certificate (`CN=cluster-tb4.example.com`), and strict TLS answers 401, i.e. the
 *   handshake succeeds and only the credential is missing. So there is no `rejectUnauthorized`
 *   option here to be left switched on by accident in somebody else's estate.
 *
 * ⚠️ EVERY PVE ANSWER IS WRAPPED IN `{"data": ...}`, errors included — a failed call can still be
 *   HTTP 200 with `{"data": null}`. Unwrapping is not cosmetic; a caller that reads the envelope
 *   as the payload sees `undefined` and calls it "absent".
 */
import * as Effect from 'effect/Effect';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import {
  type ApiTarget,
  type PveCredential,
  type PveRole,
  type PveTarget,
  authorization,
} from './credentials.ts';
import { leased } from './lease-cache.ts';
import { executeOnCluster } from './members.ts';

export class PveError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    detail: string,
  ) {
    super(`PVE ${method} ${path} -> ${String(status)}: ${detail}`);
    this.name = 'PveError';
  }
}

const clusterExhausted = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  attempts: ReadonlyArray<{ member: string; why: string }>,
) =>
  new PveError(
    0,
    method,
    path,
    `all members failed: ${attempts.map((a) => `${a.member} (${a.why})`).join('; ')}`,
  );

/**
 * A form body, where a value may be a LIST.
 *
 * ⛔ PVE AND PBS SPELL A MULTI-VALUED FIELD DIFFERENTLY, AND THE LIST FORM IS FOR PBS. PBS is Rust:
 *   its schemas use `type: array` — `delete` on every update endpoint is one — and its urlencoded
 *   decoder builds that array from REPEATED KEYS (`delete=a&delete=b`). PVE's Perl takes a comma
 *   string for the same idea, which is what `withClears` in values.ts produces, and for the one
 *   PVE field that genuinely needs repetition it wants a NUL-joined value instead (see
 *   notification-target.ts). So: PVE callers pass strings and are unaffected; a PBS caller that
 *   needs an array passes one and gets repeated keys rather than reaching for PVE's encoding.
 */
export type PveForm = Record<string, readonly string[] | string>;

/** ⚠️ `append`, NOT `set`: a repeated key is the point, and `set` would keep only the last. */
const encode = (form: PveForm): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    if (typeof value === 'string') params.append(key, value);
    else for (const item of value) params.append(key, item);
  }
  return params.toString();
};

const buildRequest = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  apiBase: string,
  path: string,
  credential: PveCredential,
  target: ApiTarget,
  form?: PveForm,
) => {
  const url = `${apiBase}/${path}`;
  /**
   * ⛔ THE CONTENT TYPE IS AN ARGUMENT TO `bodyText`, NOT AN ENTRY IN THE HEADER MAP, AND GETTING
   *   THAT WRONG MADE EVERY WRITE IN THIS PACKAGE FAIL.
   *
   * 🔴 THE BUG, AND HOW IT HID FOR A WHOLE DAY. The header map DID set
   *   `application/x-www-form-urlencoded` — and `bodyText(s)` with no second argument sets
   *   `text/plain` and OVERWRITES it, because it is piped AFTER `setHeaders`. PVE and PBS accept
   *   ONLY form encoding or JSON and reject everything else outright (measured in
   *   proxmox-rest-server's `get_request_parameters`), so every create, update and delete this
   *   package can perform was broken from the day the client was written.
   *   ⛔ NOTHING CAUGHT IT BECAUSE NOTHING HAD EVER WRITTEN. Ninety-eight resources were adopted
   *     against the live cluster and every one matched, so `reconcile` never reached a PUT. The
   *     identical bug in house/forgejo/src/client.ts surfaced the moment a write token existed
   *     and answered `422 Unsupported Content-Type`; this one is the same line, found by looking.
   *   ★ A PLAN THAT SAYS `noop` PROVES THE READ PATH AND NOTHING ELSE. That is the lesson worth
   *     more than the fix.
   *
   * ⚠️ PVE TAKES FORM ENCODING, NOT JSON. Sending application/json is accepted and then SILENTLY
   *   IGNORED on several endpoints, which reads as "the API did nothing" rather than as a wrong
   *   content type — so the type below is load bearing in both directions.
   */
  return HttpClientRequest.make(method)(url).pipe(
    HttpClientRequest.setHeaders({ Authorization: authorization(credential, target) }),
    form === undefined
      ? (self) => self
      : HttpClientRequest.bodyText(encode(form), 'application/x-www-form-urlencoded'),
  );
};

const executeOne = (
  target: ApiTarget,
  credential: PveCredential,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  form: PveForm | undefined,
  apiBase: string,
) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const request = buildRequest(method, apiBase, path, credential, target, form);
    return yield* client
      .execute(request)
      .pipe(Effect.mapError((cause) => new PveError(0, method, path, String(cause))));
  });

const readResponse = <T>(
  response: {
    status: number;
    text: Effect.Effect<string, unknown>;
    json: Effect.Effect<unknown, unknown>;
  },
  method: string,
  path: string,
) =>
  Effect.gen(function* () {
    /**
     * ⛔ STATUS FIRST, THEN THE BODY, AND THE BODY IS READ EXACTLY ONCE. `text` and `json` both
     *   consume the response stream, so asking for both is a bug waiting to happen. A failure is
     *   read as TEXT because an error body is not reliably JSON — PVE answers HTML for some 5xx —
     *   and a success is read as JSON by the client rather than by a hand-rolled `JSON.parse`.
     */
    if (response.status < 200 || response.status >= 300) {
      // ⚠️ 401 HERE USUALLY MEANS THE LEASE EXPIRED, NOT THAT THE ROLE IS WRONG. `provision` is a
      //   300s non-renewable lease; a long reconcile should mint again rather than widen the role.
      const detail = yield* response.text.pipe(Effect.orElseSucceed(() => ''));
      return yield* Effect.fail(new PveError(response.status, method, path, detail.slice(0, 300)));
    }
    const body = (yield* response.json.pipe(
      Effect.mapError((cause) => new PveError(0, method, path, String(cause))),
    )) as { data?: T };
    return body.data;
  });

/** A call that already holds a credential. Used when one mint serves several calls. */
export const pveWith = <T>(
  target: ApiTarget,
  credential: PveCredential,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  form?: PveForm,
) =>
  Effect.gen(function* () {
    const response =
      target.scheme === 'pve'
        ? yield* executeOnCluster(target, method, path, (apiBase) =>
            buildRequest(method, apiBase, path, credential, target, form),
          ).pipe(
            Effect.mapError((failure) =>
              failure.tag === 'cluster'
                ? clusterExhausted(failure.method, failure.path, failure.attempts)
                : new PveError(0, method, path, String(failure)),
            ),
          )
        : yield* executeOne(target, credential, method, path, form, target.api);
    return yield* readResponse<T>(response, method, path);
  });

/**
 * Like `pveWith`, but returns the full JSON body — for endpoints whose answer lives beside `data`.
 *
 * ⚠️ `network-apply-read.ts` is the caller today; the local fetch there should fold into this once
 *   the envelope shape is stable across both paths.
 */
export const pveEnvelopeWith = (
  target: PveTarget,
  credential: PveCredential,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
) =>
  Effect.gen(function* () {
    const response = yield* executeOnCluster(target, method, path, (apiBase) =>
      buildRequest(method, apiBase, path, credential, target),
    ).pipe(
      Effect.mapError((failure) =>
        failure.tag === 'cluster'
          ? clusterExhausted(failure.method, failure.path, failure.attempts)
          : new PveError(0, method, path, String(failure)),
      ),
    );
    if (response.status < 200 || response.status >= 300) {
      const detail = yield* response.text.pipe(Effect.orElseSucceed(() => ''));
      return yield* Effect.fail(new PveError(response.status, method, path, detail.slice(0, 300)));
    }
    return (yield* response.json.pipe(
      Effect.mapError((cause) => new PveError(0, method, path, String(cause))),
    )) as Record<string, unknown>;
  });

/**
 * Make one call on a credential for `role`, REUSING a still-valid lease rather than minting one.
 *
 * 🔴 IT USED TO MINT PER CALL, AND AT 98 RESOURCES THAT STOPPED BEING FREE. One plan plus deploy
 *   of the TB4 stack left 760 token entries in `/etc/pve/user.cfg` — read, diff, reconcile and the
 *   read-back each minted their own, and `/etc/pve` is a replicated cluster filesystem every node
 *   has to agree on. src/lease-cache.ts carries the measurement and the safety argument.
 *
 * ⚠️ `pveWith` IS STILL THERE AND STILL TAKES AN EXPLICIT CREDENTIAL. network-apply.ts needs ONE
 *   identity across its apply and its task poll — PVE only skips the task-status privilege check
 *   for the task's OWNER — and it threads a lease through by hand for that. Caching makes that
 *   property easier to hold, never weaker, but the explicit path stays because that caller is
 *   reasoning about identity rather than about cost.
 *
 * ★ TASK POLL ON A DIFFERENT MEMBER THAN THE APPLY STILL HOLDS: the owner is the token id, not the
 *   node that received the PUT. Any member serves any task path; the privilege skip is keyed on
 *   whether the caller IS the task's owner.
 */
export const pve = <T>(
  target: ApiTarget,
  role: PveRole,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  form?: PveForm,
) =>
  Effect.gen(function* () {
    const credential = yield* leased(target, role);
    return yield* pveWith<T>(target, credential, method, path, form);
  });
