/**
 * ProxmoxBackupProtocol — the shared bearer-REST protocol instantiated for
 * Proxmox Backup Server. Hand-written; `@distilled.cloud/core` is never
 * changed for a provider's own quirks — they all live here.
 *
 * Ported from `packages/proxmox/src/protocol.ts` in this same distilled
 * clone. Three of PVE's "THREE 200-TRAPS" carry forward; the fourth
 * (cluster-forwarding 595) does not exist for PBS — see `src/errors.ts`'s
 * header. Each trap below cites what was actually checked against the
 * pinned schema (`~/.cache/homeflare/schemas/proxmox/
 * pbs_4.2.6-1_apidoc.js`), versus what is carried by same-vendor
 * architecture and NOT independently measured (this build makes no live
 * PBS calls).
 *
 * ## The envelope
 *
 * Every PBS response is wrapped `{"data": …}`, the same as PVE.
 * ⚠️ NOT independently measured live (no PBS credential exists to call
 * with). Asserted, not just assumed: `taslabs-net/homeflare-kit`'s
 * `packages/alchemy/src/proxmox/credentials.ts` documents PVE and PBS
 * sharing ONE http client specifically BECAUSE "Proxmox Backup Server
 * speaks the same `/api2/json` paths, wraps every answer in the same
 * `{"data": …}` envelope" — also written before that repo had a live PBS
 * credential, so this is the same vendor-architecture inference stated
 * independently in two places, not two confirmations of one live check.
 * `transformResponse` below unwraps it before `core/protocol-rest`'s
 * schema-driven decode ever sees a payload, exactly as PVE's does.
 *
 * ## Authentication
 *
 * The API-token scheme: `Authorization: PBSAPIToken=<user>@<realm>!
 * <tokenid>:<secret>` — MEASURED DIFFERENT FROM PVE: a colon separator,
 * not `=`, and a `PBSAPIToken` prefix, not `PVEAPIToken`. See
 * `src/credentials.ts`'s header for the two independent citations (kit
 * `credentials.ts` and `pbs-prune-job.ts`) and their shared caveat
 * (reasoned from PBS's documented scheme, not a live call either).
 *
 * ## THE TRAPS CARRIED FROM PVE (measured against the pinned schema)
 *
 * (a) **Async POST/PUT/DELETE answer 200 with a UPID and can fail later.**
 *     CONFIRMED IN SCHEMA: the pinned file's `pattern` for UPID-shaped
 *     strings appears 44 times, and `GET /nodes/{node}/tasks/{upid}/status`
 *     exists (measured: `grep -n 'tasks/{upid}/status'` finds it at line
 *     25814) — the identical path shape PVE's own `awaitTask` polls.
 *     Handled with real code: `src/task.ts`'s `awaitTask`, unchanged in
 *     its `"OK"` exact-equality logic from PVE's (see that file's header
 *     for why `"OK (warnings)"` must not match a prefix/substring check).
 *
 * (b) **Some PUTs answer 200 `{"data":null}` even when nothing changed.**
 *     CONFIRMED IN SCHEMA: e.g. `PUT /access/acl` and `PUT /access/
 *     password` both declare `"returns": {"type": "null"}` (measured,
 *     among 53 total PUT endpoints in the pinned schema) — the same
 *     declared-null-return signature PVE's update endpoints carry. THIS IS
 *     NOT SOMETHING A PROTOCOL LAYER CAN DETECT OR FIX; documented here so
 *     it travels with the protocol.
 *
 * (c) **Permission-filtered lists return 200 + `[]` instead of 403.**
 *     CONFIRMED IN SCHEMA: `GET /access/acl`'s own `permissions.description`
 *     reads "Returns all ACLs if user has Sys.Audit on '/access/acl', or
 *     just the ACLs containing the user's API tokens" (measured, line 32
 *     of the pinned file) — the identical conditional-visibility-by-token
 *     phrasing the PVE package's header cites for this trap, not a guess
 *     by analogy. Also undetectable here for the same reason as (b).
 *
 * ## NOT carried: cluster-forwarding 595
 *
 * See `src/errors.ts`'s header — the pinned schema has zero `proxyto`
 * occurrences. PBS is not a cluster product.
 *
 * ## Self-signed TLS
 *
 * Same as PVE: explicitly not handled here or anywhere in this package —
 * the `HttpClient.HttpClient` layer the caller provides owns that
 * decision.
 */
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type * as HttpClientError from "effect/unstable/http/HttpClientError";
import type * as API from "@distilled.cloud/core/api";
import {
  BadRequest,
  HTTP_STATUS_MAP,
  type ConfigError,
} from "@distilled.cloud/core/errors";
import {
  makeRestProtocol,
  type RestErrorEnvelope,
} from "@distilled.cloud/core/protocol-rest";
import { Credentials, type Config } from "./credentials.ts";
import {
  ParameterVerificationFailed,
  UnknownProxmoxBackupError,
  type DefaultErrors,
} from "./errors.ts";

/**
 * Error channel shared by every generated Proxmox Backup Server operation.
 * Generated service files annotate operations with
 * `API.OperationMethod<I, O, ProxmoxBackupOpError, ProxmoxBackupOpContext>`
 * explicitly so the compiler never infers these back out of the schema
 * generics.
 */
export type ProxmoxBackupOpError =
  | DefaultErrors
  | ConfigError
  | HttpClientError.HttpClientError;

/** Context (requirements) shared by every generated Proxmox Backup Server operation. */
export type ProxmoxBackupOpContext = Credentials | HttpClient.HttpClient;

/**
 * PBS's failure envelope is `{"data": null, "message": "...", "errors"?:
 * {…}}` — see PVE's identical `errorEnvelope` for why `message` alone is
 * read here (the `errors` sub-object is read straight from the body in
 * `unknownError` below, never here).
 */
const errorEnvelope = (body: unknown): RestErrorEnvelope | undefined => {
  if (body === null || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  return { message: typeof b.message === "string" ? b.message : undefined };
};

/**
 * `HTTP_STATUS_MAP` minus 400 — same reasoning as PVE's copy: PBS's 400 is
 * specifically the parameter-verification failure, and the generic
 * `BadRequest` would throw away the per-field `errors` object.
 */
const PROXMOX_BACKUP_STATUS_MAP: Record<number, new (args: any) => unknown> = {
  ...HTTP_STATUS_MAP,
};
delete (PROXMOX_BACKUP_STATUS_MAP as Record<number, unknown>)[400];

export const ProxmoxBackupProtocol: Layer.Layer<API.Protocol> =
  makeRestProtocol<Config>({
    credentials: Effect.gen(function* () {
      const resolve = yield* Credentials;
      return yield* resolve;
    }),
    baseUrl: (creds) => creds.apiBaseUrl,
    headers: (creds) => ({
      // ⛔ COLON, NOT `=` — see the module header's Authentication section.
      Authorization: `PBSAPIToken=${creds.tokenId}:${Redacted.value(creds.secret)}`,
      Accept: "application/json",
    }),
    errorEnvelope,
    statusMap: PROXMOX_BACKUP_STATUS_MAP,
    // Unwrap PBS's `{"data": …}` envelope BEFORE the schema-driven decode —
    // see the module header. `data` is `null`/absent for a Unit-output
    // operation; `?? {}` is core's own convention for "no body".
    transformResponse: (body) => {
      if (
        body !== null &&
        typeof body === "object" &&
        "data" in (body as Record<string, unknown>)
      ) {
        return (body as Record<string, unknown>).data ?? {};
      }
      return body;
    },
    // Reached for a 400 (see PROXMOX_BACKUP_STATUS_MAP above) or a status
    // with no core mapping at all. `body` is the FULL parsed failure
    // envelope, so this is where PBS's per-field `errors` object is read.
    //
    // ⛔ A BARE 400 WITHOUT THE `errors` OBJECT MUST NOT FALL INTO
    //   `UnknownProxmoxBackupError` — same retry-amplification hazard
    //   PVE's identical comment explains (`ServerError` is retried
    //   automatically; a malformed request is permanent). `BadRequest`
    //   (`Category.withBadRequestError`, not retryable) is the honest
    //   answer for "PBS said 400 and gave no further structure".
    unknownError: ({ status, message, body }) => {
      const b =
        body !== null && typeof body === "object"
          ? (body as Record<string, unknown>)
          : undefined;
      const fieldErrors = b?.errors;
      if (status === 400) {
        if (
          fieldErrors !== null &&
          typeof fieldErrors === "object" &&
          !Array.isArray(fieldErrors)
        ) {
          const errors: Record<string, string> = {};
          for (const [k, v] of Object.entries(
            fieldErrors as Record<string, unknown>,
          )) {
            if (typeof v === "string") errors[k] = v;
          }
          return new ParameterVerificationFailed({ message, errors });
        }
        return new BadRequest({ message });
      }
      return new UnknownProxmoxBackupError({ status, message, body });
    },
  });
