/**
 * Proxmox VE-specific error types.
 *
 * Re-exports the common HTTP errors from core and adds PVE's own failure
 * shapes — see `src/protocol.ts` for how each is recognized on the wire.
 *
 * ★ TWO DIFFERENT WIRING STYLES, ON PURPOSE:
 *   - `ParameterVerificationFailed` (and the plain `BadRequest` fallback
 *     for a 400 PVE didn't attach an `errors` object to) is GLOBAL
 *     (`commonErrorClasses`) — recognized generically in `protocol.ts`'s
 *     `unknownError`, which core's `makeRestProtocol` reaches LAST, after
 *     per-op `matchTypedError` and the status map both miss (never
 *     "before per-op matching runs" — 400 is deliberately absent from
 *     `PROXMOX_STATUS_MAP` so it always lands there). ANY write can fail
 *     parameter verification, so patching all 680 generated operations
 *     with the same error shape would be the RFC-6902 equivalent of
 *     copy-pasting one line 680 times for no additional truth. `BadRequest`
 *     matters here specifically because it is NOT retryable
 *     (`Category.withBadRequestError`) where `UnknownProxmoxError`'s
 *     `Category.withServerError` IS (core's default retry policy treats
 *     `ServerError` as transient) — see `protocol.ts`'s `unknownError` for
 *     the incident this prevents: a permanent 400 must never be retried.
 *   - `ClusterNodeUnreachable` is added via an ACTUAL RFC-6902 patch —
 *     `patches/nodes/task-polling.json` — to the four `/nodes/{node}/
 *     tasks/…` operations the vendor schema itself marks `proxyto: "node"`
 *     (a caller polling `GetNodeTaskStatus` — this package's own generated
 *     operation — can hit any of the four; task polling itself is
 *     provider-side, not this package's, per P13/Q3 of the 2026-09-24
 *     walk-down: no distilled precedent for a package-level poll helper).
 *     It is NOT
 *     global: most PVE calls are answered by the node you connected to
 *     directly and never proxy at all, so declaring a 595 possible on
 *     every operation would be a claim the schema does not support for
 *     most of them. Matched purely by status (never a guessed message —
 *     see the patch file).
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
// Re-exports do not bind names locally. The operation union must cover every
// class the package protocol can return through core's HTTP_STATUS_MAP.
import type { API_ERRORS } from "@distilled.cloud/core/errors";

import * as Schema from "effect/Schema";
import * as Category from "@distilled.cloud/core/category";

/**
 * PVE's generic parameter-validation failure: `400` with `{"data":null,
 * "errors":{"<param>":"<message>", …}, "message":"Parameter verification
 * failed."}` — measured in `taslabs-net/homeflare-kit`'s
 * `codegen/README.md` (the incident that package's whole vendor-schema
 * pipeline exists to prevent): `PVE POST config/verify -> 400: parameter
 * verification failed - comment: value may only be 128 characters long`.
 * `errors` carries the per-field messages verbatim.
 */
export class ParameterVerificationFailed extends Schema.TaggedError<ParameterVerificationFailed>()(
  "ParameterVerificationFailed",
  {
    message: Schema.String,
    errors: Schema.Record(Schema.String, Schema.String),
  },
).pipe(Category.withBadRequestError) {}

/**
 * PVE's non-standard status for a cluster-forwarded request whose target
 * node could not be reached (`pveproxy`/`pvedaemon` proxying — every
 * endpoint the vendor schema marks `proxyto` can answer this). Standard
 * HTTP has no 595; this is PVE's own convention, matched purely by status
 * (never guessed message text — see `protocol.ts`). Treated as transient:
 * the node the request was forwarded to may simply be mid-reboot or
 * between cluster-membership changes.
 */
export class ClusterNodeUnreachable extends Schema.TaggedError<ClusterNodeUnreachable>()(
  "ClusterNodeUnreachable",
  {
    message: Schema.String,
  },
).pipe(Category.withServerError, Category.withRetryable()) {}

/**
 * Unknown Proxmox error — returned when a failed response's HTTP status has
 * no mapped error class. Carries the raw body for later cataloging.
 */
export class UnknownProxmoxError extends Schema.TaggedError<UnknownProxmoxError>()(
  "UnknownProxmoxError",
  {
    status: Schema.optional(Schema.Number),
    message: Schema.optional(Schema.String),
    body: Schema.Unknown,
  },
).pipe(Category.withServerError) {}

/** Schema parse error wrapper. */
export class ProxmoxParseError extends Schema.TaggedError<ProxmoxParseError>()(
  "ProxmoxParseError",
  {
    body: Schema.Unknown,
    cause: Schema.Unknown,
  },
).pipe(Category.withParseError) {}

/**
 * A polled task ended with an `exitstatus` other than exactly `"OK"`.
 * `exitstatus` carries PVE's own failure text verbatim (e.g. `"job
 * errors"`, `"OK (warnings)"` — the latter is why a caller's compare must
 * be exact-equality against `"OK"`, never a prefix/substring check).
 * Exported for a provider-side poll to construct: this package no longer
 * ships its own `awaitTask` helper (removed 2026-09-24 — polling belongs
 * in the provider, P13; no distilled precedent for a package-level poll).
 */
export class ProxmoxTaskFailed extends Schema.TaggedError<ProxmoxTaskFailed>()(
  "ProxmoxTaskFailed",
  {
    node: Schema.String,
    upid: Schema.String,
    exitstatus: Schema.String,
  },
) {}

/**
 * Errors any Proxmox operation may surface in addition to the per-operation
 * typed status errors.
 */
export type ClientErrors = UnknownProxmoxError | ProxmoxParseError;

/**
 * Default Proxmox operation errors: the shared HTTP status errors from
 * core, PVE's global parameter-verification failure, plus the client-level
 * fallback/decode errors. `ClusterNodeUnreachable` is NOT here — see the
 * header: it rides only the specific operations `patches/nodes/
 * task-polling.json` adds it to.
 */
export type DefaultErrors =
  | InstanceType<(typeof API_ERRORS)[number]>
  | ParameterVerificationFailed
  | ClientErrors;
