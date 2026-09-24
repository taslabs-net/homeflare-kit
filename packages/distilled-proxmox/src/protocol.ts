/**
 * ProxmoxProtocol — the shared bearer-REST protocol instantiated for
 * Proxmox VE. Hand-written; `@distilled.cloud/core` is never changed for a
 * provider's own quirks — they all live here.
 *
 * ## The envelope
 *
 * Every PVE response — success AND failure — is wrapped `{"data": …}`
 * (measured, and already relied on by `packages/alchemy/src/proxmox/
 * client.ts` in `taslabs-net/homeflare-kit`: "EVERY PVE ANSWER IS WRAPPED
 * IN `{"data": ...}`, errors included — a failed call can still be HTTP
 * 200 with `{"data": null}`"). `transformResponse` below unwraps it before
 * `core/protocol-rest`'s schema-driven decode ever sees a payload, so a
 * generated operation's output type is the PAYLOAD, not the envelope.
 *
 * ## Authentication
 *
 * The API-token scheme: `Authorization: PVEAPIToken=<user>@<realm>!
 * <tokenid>=<secret>` (no `Bearer`, and the token id is embedded in the
 * header value itself, not just the credential).
 *
 * ## THE THREE 200-TRAPS
 *
 * (a) **Async POST/PUT/DELETE answer 200 with a UPID and can fail later.**
 *     PVE hands back a bare task id string (`"UPID:node:...);"`) for any
 *     long-running action — a VM start, a backup, a storage scan — and the
 *     200 means "the task was QUEUED", not "the task succeeded". A caller
 *     must poll `GetNodeTaskStatus` (this package's own generated
 *     operation) until `exitstatus` is present, then treat anything other
 *     than EXACTLY `"OK"` as a failure — PVE also answers `"OK
 *     (warnings)"`, so a bare-prefix match is wrong. This package ships
 *     the typed `ProxmoxTaskFailed` for that comparison but not the poll
 *     loop itself: polling is provider-side (P13 of the 2026-09-24
 *     walk-down; no distilled precedent for a package-level poll helper —
 *     see `errors.ts`'s `ProxmoxTaskFailed` doc for the removal note).
 *
 * (b) **Some PUTs answer 200 `{"data":null}` even when nothing changed.**
 *     PVE's update handlers commonly return `null` unconditionally on
 *     success, whether or not any field actually differed from what was
 *     already stored — there is no wire signal that distinguishes "applied"
 *     from "already exactly this". THIS IS NOT SOMETHING A PROTOCOL LAYER
 *     CAN DETECT OR FIX — it is a statement about business semantics no
 *     amount of parsing recovers. Documented here so it travels with the
 *     protocol rather than being rediscovered per resource: an update
 *     operation's caller (a future kit `Resource`) MUST read the value back
 *     with a follow-up GET rather than trust a 200 as proof anything
 *     changed.
 *
 * (c) **Permission-filtered lists return 200 + `[]` instead of 403.** A
 *     list endpoint called with a token that has no visibility into any
 *     member of the collection answers an EMPTY array, not a permission
 *     error — indistinguishable, on the wire, from "the collection is
 *     genuinely empty". Also undetectable here for the same reason as (b):
 *     documented so a caller treats an empty list from a narrowly-scoped
 *     token as "unknown", never as "confirmed absent".
 *
 * ## Self-signed TLS
 *
 * A fresh PVE node serves its own self-signed certificate. This is
 * EXPLICITLY NOT handled here, or anywhere in this package: the custom
 * CA / certificate trust decision belongs to the `HttpClient.HttpClient`
 * layer the CALLER provides (Effect's platform HTTP client layers take a
 * `NodeHttpClient.layerConfig` / custom `Agent` for this), never to a
 * distilled protocol module, which only ever builds and decodes requests
 * against whatever transport it is handed. Wiring a custom CA at the
 * `HttpClient` layer is a caller decision to prototype and own.
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
import { withPveFormArrays } from "./protocol-form.ts";
import {
  ParameterVerificationFailed,
  UnknownProxmoxError,
  type DefaultErrors,
} from "./errors.ts";

/**
 * Error channel shared by every generated Proxmox operation. Generated
 * service files annotate operations with `API.OperationMethod<I, O,
 * ProxmoxOpError, ProxmoxOpContext>` explicitly so the compiler never
 * infers these back out of the schema generics.
 */
export type ProxmoxOpError =
  | DefaultErrors
  | ConfigError
  | HttpClientError.HttpClientError;

/** Context (requirements) shared by every generated Proxmox operation. */
export type ProxmoxOpContext = Credentials | HttpClient.HttpClient;

/**
 * PVE's failure envelope is `{"data": null, "message": "...", "errors"?:
 * {…}}` — `message` is the only field every failure carries (the `errors`
 * sub-object, PVE's parameter-verification detail, is read straight from
 * the body in `unknownError` below, not here — `RestErrorEnvelope` has no
 * room for a nested object and `errorEnvelope` only feeds per-op typed-error
 * MATCHING, never the classes themselves).
 */
const errorEnvelope = (body: unknown): RestErrorEnvelope | undefined => {
  if (body === null || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  // PVE missing backup/interface/alias exceptions carry the useful message in one
  // field (Backup.pm:406,458; Network.pm:852; Firewall/Aliases.pm:203). Expose
  // ONLY those exact sole-field details to the operation's typed matcher.
  // Multiple errors, other fields, and unrelated validation stay unchanged.
  const errors = b.errors;
  if (
    (b.message === "Parameter verification failed." ||
      b.message === "Parameter verification failed.\n") &&
    errors !== null &&
    typeof errors === "object" &&
    !Array.isArray(errors) &&
    Object.keys(errors).length === 1
  ) {
    if (
      "id" in errors &&
      typeof errors.id === "string" &&
      /^No such job '[^']+'$/.test(errors.id)
    )
      return { message: errors.id };
    if ("name" in errors && errors.name === "no such alias") {
      return { message: errors.name };
    }
    if ("iface" in errors && errors.iface === "interface does not exist") {
      return { message: errors.iface };
    }
  }
  return { message: typeof b.message === "string" ? b.message : undefined };
};

/**
 * `HTTP_STATUS_MAP` minus 400: PVE's 400 is not one shape (a generic
 * "bad request" some other providers mean by it) — it is SPECIFICALLY the
 * parameter-verification failure, and answering it with the generic
 * `BadRequest` would throw away the per-field `errors` object the vendor
 * always attaches. Dropping the entry here is what lets a 400 fall through
 * to `unknownError`, which reads that object.
 */
const PROXMOX_STATUS_MAP: Record<number, new (args: any) => unknown> = {
  ...HTTP_STATUS_MAP,
};
delete (PROXMOX_STATUS_MAP as Record<number, unknown>)[400];

export const ProxmoxProtocol: Layer.Layer<API.Protocol> = withPveFormArrays(
  makeRestProtocol<Config>({
    // Resolved on the CALLING fiber per request (the layer is memoized per
    // process); the Credentials service holds an effect, so a token rotated
    // between calls is picked up without rebuilding the layer.
    credentials: Effect.gen(function* () {
      const resolve = yield* Credentials;
      return yield* resolve;
    }),
    baseUrl: (creds) => creds.apiBaseUrl,
    headers: (creds) => ({
      Authorization: `PVEAPIToken=${creds.tokenId}=${Redacted.value(creds.secret)}`,
      Accept: "application/json",
    }),
    errorEnvelope,
    statusMap: PROXMOX_STATUS_MAP,
    // Unwrap PVE's `{"data": …}` envelope BEFORE the schema-driven decode —
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
    // Reached for a 400 (see PROXMOX_STATUS_MAP above), an operation-declared
    // typed error that didn't match (`ClusterNodeUnreachable`'s 595 — see
    // `patches/nodes/task-polling.json` — when the status is right but the
    // matcher's other fields aren't), or a status with no core mapping at
    // all. `body` is the FULL parsed failure envelope (unlike
    // `errorEnvelope`, which only ever sees `{code?, message?}`), so this is
    // where PVE's per-field `errors` object is actually read.
    //
    // ⛔ A BARE 400 WITHOUT THE `errors` OBJECT MUST NOT FALL INTO
    //   `UnknownProxmoxError`. That class is `.pipe(Category.withServerError)`
    //   (matching every other provider's Unknown*Error fallback here), and
    //   `ServerError` is one of the categories `core/category.ts`'s
    //   `isTransientError` retries AUTOMATICALLY — with no caller opt-in —
    //   via `makeDefault` (`core/api.ts`: `Option.isSome(opt) ? opt.value :
    //   makeDefault` when no retry policy is in context). A malformed
    //   request is permanent; retrying it up to `makeDefault`'s cap before
    //   finally surfacing would silently multiply every truly-bad call by
    //   several attempts and several seconds of backoff for no chance of a
    //   different outcome. `BadRequest` (`Category.withBadRequestError`,
    //   not retryable) is the honest answer for "PVE said 400 and gave no
    //   further structure" — `UnknownProxmoxError` stays for statuses this
    //   package genuinely has no mapping for at all (never 400).
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
      return new UnknownProxmoxError({ status, message, body });
    },
  }),
);
