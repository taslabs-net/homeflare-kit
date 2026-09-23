/**
 * Proxmox Backup Server-specific error types.
 *
 * Ported from `packages/proxmox/src/errors.ts` in this same distilled
 * clone, with one deliberate omission — see the ⛔ below.
 *
 * ⛔ NO `ClusterNodeUnreachable`, NO `patches/nodes/task-polling.json`.
 *   PVE's version of this file adds a `ClusterNodeUnreachable` (HTTP 595)
 *   error via an RFC-6902 patch to the four `/nodes/{node}/tasks/…`
 *   operations the VENDOR SCHEMA marks `proxyto: "node"` (PVE forwards a
 *   request to whichever cluster member actually owns the task). MEASURED:
 *   the pinned PBS schema (`~/.cache/homeflare/schemas/proxmox/
 *   pbs_4.2.6-1_apidoc.js`) has ZERO occurrences of `"proxyto"` anywhere —
 *   `grep -c '"proxyto"'` on the full 1.5 MB file returns 0. This is
 *   expected, not a gap: PBS is a single-host backup datastore product,
 *   not a cluster, so there is nothing for a request to be forwarded to.
 *   Carrying the 595 error and its patch forward would assert a failure
 *   mode the vendor schema gives no evidence for. `src/task.ts`'s
 *   `awaitTask` here therefore has a narrower error union than PVE's.
 */
export {
  BadGateway,
  BadRequest,
  Conflict,
  ConfigError,
  Forbidden,
  GatewayTimeout,
  InternalServerError,
  Locked,
  NotFound,
  ServiceUnavailable,
  TooManyRequests,
  Unauthorized,
  UnprocessableEntity,
  HTTP_STATUS_MAP,
  DEFAULT_ERRORS,
  API_ERRORS,
} from "@distilled.cloud/core/errors";
// `export { X } from "mod"` (above) is a RE-EXPORT ONLY — it creates no local
// binding for `X`, so `BadRequest` needs its own `import type` to be usable
// in this file's own `DefaultErrors` union below.
import type {
  BadRequest,
  DefaultErrors as CoreDefaultErrors,
} from "@distilled.cloud/core/errors";

import * as Schema from "effect/Schema";
import * as Category from "@distilled.cloud/core/category";

/**
 * PBS's generic parameter-validation failure: `400` with `{"data":null,
 * "errors":{"<param>":"<message>", …}, "message":"parameter verification
 * failed"}`. ⚠️ NOT INDEPENDENTLY MEASURED AGAINST A LIVE PBS HOST (this
 * build makes no live PBS calls). Carried forward from PVE's identical,
 * measured shape on the strength of same-vendor architecture: PBS's own
 * api-viewer/apidoc.js is the same schema-driven tooling PVE's is (the
 * `apidoc.ts` parser in this package reads both with only a declaration-
 * syntax and terminator difference — see that file's header), and
 * `taslabs-net/homeflare-kit`'s `packages/alchemy/src/proxmox/
 * credentials.ts` documents PBS and PVE as literally sharing one HTTP
 * client because "PBS is the same client with a different Authorization
 * header" — i.e. the `{"data": …}` envelope and error shape are asserted
 * identical there too, also without a live PBS credential to confirm
 * against. Flagged here as INFERRED, not measured, so a future caller who
 * DOES get a live token knows to re-check this specific claim first.
 */
export class ParameterVerificationFailed extends Schema.TaggedError<ParameterVerificationFailed>()(
  "ParameterVerificationFailed",
  {
    message: Schema.String,
    errors: Schema.Record(Schema.String, Schema.String),
  },
).pipe(Category.withBadRequestError) {}

/**
 * Unknown Proxmox Backup Server error — returned when a failed response's
 * HTTP status has no mapped error class. Carries the raw body for later
 * cataloging.
 */
export class UnknownProxmoxBackupError extends Schema.TaggedError<UnknownProxmoxBackupError>()(
  "UnknownProxmoxBackupError",
  {
    status: Schema.optional(Schema.Number),
    message: Schema.optional(Schema.String),
    body: Schema.Unknown,
  },
).pipe(Category.withServerError) {}

/** Schema parse error wrapper. */
export class ProxmoxBackupParseError extends Schema.TaggedError<ProxmoxBackupParseError>()(
  "ProxmoxBackupParseError",
  {
    body: Schema.Unknown,
    cause: Schema.Unknown,
  },
).pipe(Category.withParseError) {}

/**
 * A polled task ended with an `exitstatus` other than exactly `"OK"` — see
 * `src/task.ts`. `exitstatus` carries PBS's own failure text verbatim.
 */
export class ProxmoxBackupTaskFailed extends Schema.TaggedError<ProxmoxBackupTaskFailed>()(
  "ProxmoxBackupTaskFailed",
  {
    node: Schema.String,
    upid: Schema.String,
    exitstatus: Schema.String,
  },
) {}

/**
 * Errors any Proxmox Backup Server operation may surface in addition to
 * the per-operation typed status errors.
 */
export type ClientErrors = UnknownProxmoxBackupError | ProxmoxBackupParseError;

/**
 * Default Proxmox Backup Server operation errors: the shared HTTP status
 * errors from core, PBS's global parameter-verification failure, plus the
 * client-level fallback/decode errors.
 */
export type DefaultErrors =
  | CoreDefaultErrors
  | BadRequest
  | ParameterVerificationFailed
  | ClientErrors;
