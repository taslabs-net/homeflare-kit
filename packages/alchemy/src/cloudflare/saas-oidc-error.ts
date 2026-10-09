/**
 * The one error type of the SaaS OIDC resource, and the handler that keeps the SDK's raw
 * `CloudflareParseError` (which can hold the client secret) from leaving this package.
 *
 * ⛔ THE LEAK. A response that fails schema validation becomes `CloudflareParseError({ body, cause })`
 *   (`@distilled.cloud/cloudflare@1.0.0-rc.13` protocol.ts:452-457). `body` is the WHOLE parsed
 *   response, a create response included, and for a confidential client that carries
 *   `client_secret`; `cause` is a SchemaError that quotes the values that failed. A raw SDK error
 *   that reached an engine log or a trace would print both.
 * ★ THE FIX is at every SDK call of this resource (create, update, list, delete, and the
 *   organization read in saas-oidc-team.ts): `Effect.catchTag('CloudflareParseError', withheld(…))`,
 *   applied before the retry or any other combinator sees the error. It is the house's catchTag
 *   doctrine (a typed tag, no status or message sniffing), and the replacement carries the
 *   operation name and nothing from the response. The raw `get` in saas-oidc-api.ts is not an SDK
 *   call and never builds this error.
 * ⚠️ WHEN IT CAN HAPPEN AT ALL. The error exists only under STRICT response validation (core
 *   response-validation.ts:29 "without one, every call is lenient", :104-116); neither Alchemy nor
 *   this kit turns strict on, so a consumer's own `ResponseValidation.strict` is what makes it
 *   reachable. MEASURED 2026-10-09 against rc.13 under strict validation: a create or update
 *   response decodes against `S.Unknown` (`AccessApplicationsCreateResult`, zero_trust.ts:35025;
 *   `AccessApplicationsUpdateResult`, :210218), which accepts anything, so the real SDK cannot
 *   raise it for those two today (the tests reach them through `sdkWrites` in saas-oidc-api.ts).
 *   List (a non-array result, :147403-147410), delete (`id` typed, :61601-61607) and the organization
 *   read (:169193-169253) are typed and can. The catch is on all five so a later SDK that types the
 *   union cannot start leaking.
 * ⛔ `DISTILLED_DEBUG_HTTP` is the other raw-body path and stays an operator-only switch: the
 *   package refuses a write while it is set (`refuseDebugHttp`), it cannot stop the SDK printing.
 */
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';

/** A refusal or failure, carrying the sentence an operator needs. Never a secret. */
export class SaasOidcError extends Data.TaggedError('SaasOidcError')<{
  readonly message: string;
  /** The HTTP status when the failure is a response (0 for a transport failure). */
  readonly status?: number;
}> {}

/**
 * ⛔ THE ONLY THING THIS PACKAGE SAYS ABOUT A RESPONSE THE SDK COULD NOT VALIDATE. The handler for
 *   `Effect.catchTag('CloudflareParseError', …)`: it never touches the error it replaces, because
 *   that error's `body` is the whole response (a create's carries `client_secret`) and its `cause`
 *   quotes the values that failed. The message names the operation only. No status is claimed: the
 *   SDK builds this error after its failure branch (protocol.ts:359, :452), so the response was a
 *   success as far as HTTP and the envelope go, and nothing more is known.
 */
export const withheld = (operation: string) => (): Effect.Effect<never, SaasOidcError> =>
  Effect.fail(
    new SaasOidcError({
      message: `Access ${operation} succeeded at the HTTP level but the SDK could not validate the response. The response is withheld on purpose (a create response carries the client secret). Check the application in the Zero Trust dashboard, then run again.`,
    }),
  );
