/**
 * The typed refusals `LiteLLM.Credential` raises on top of `@distilled.cloud/litellm`'s own SDK
 * errors.
 *
 * ⛔ NO MESSAGE HERE MAY CARRY A CREDENTIAL VALUE: only the credential's NAME, field names, the
 *   NAMES of environment variables, and SDK error text — exactly like mcp-server-errors.ts.
 * ⚠️ THE SDK'S TYPED UNION IS NARROW ON PURPOSE, and the runtime is wider: the credential routes
 *   declare only `UnprocessableEntity` (422) in `credential_management.ts`, so a create on an
 *   existing name — which the live 1.103.0 container answers `409` (`endpoints.py`'s
 *   `_credential_exists_detail`) — decodes at run time as the core `Conflict` class (`Errors.ts`
 *   re-exports it, but it is not in the operation's TS union) and PROPAGATES as such, never
 *   silently swallowed (S21). The read's and delete's `404` is TYPED as the SDK's
 *   `CredentialNotFound` (a distilled patch matched on the vendor's "Credential not found"
 *   message, `endpoints.py`), so credential-operations.ts `catchTag`s it instead of `instanceof`
 *   `NotFound`: a 404 from a front proxy, Access, or a wrong base path stays a `NotFound` and is
 *   never read as absence. `CredentialError` carries the typed members of the four operations the
 *   resource calls (create, by-name read, PATCH, delete), plus the refusals below.
 */
import type * as credentials from '@distilled.cloud/litellm/credential_management';
import * as Data from 'effect/Data';
import type { HttpClientErrorReason } from 'effect/http/HttpClientError';

/** A declaration the resource refuses before any request: a combination nobody meant. */
export class LitellmCredentialInvalidError extends Data.TaggedError(
  'LitellmCredentialInvalidError',
)<{
  readonly credentialName: string;
  readonly problem: string;
}> {
  override get message(): string {
    return `LiteLLM.Credential "${this.credentialName}": ${this.problem}.`;
  }
}

/**
 * A create's `POST /credentials` or an update's `PATCH /credentials/{name}` failed on the wire (or
 * its answer could not be read), so nobody knows whether the credential is what was asked for.
 *
 * ⛔ THIS IS WHAT STANDS IN FOR AN `HttpClientError`, WHICH CARRIES ITS REQUEST, AND THE REQUEST
 *   BODY OF A CREATE OR UPDATE IS `{"credential_name": …, "credential_values": {"api_key": "…"}}`.
 *   Measured 2026-09-30: on a dropped connection `JSON.stringify(error)`, `Bun.inspect(error)` and
 *   Effect's JSON logger all printed the value, as did a failed deploy over it — the same leak
 *   key-operations.ts's `LitellmKeyTransportError` closes. A defect reading a broken answer
 *   (`protocol-rest.ts` reads it `Effect.orDie`) carries the same request. So `reason` keeps the
 *   `HttpClientError` reason's TAG (a string) and nothing else: no request, no cause, no
 *   description. The credential NAME stays — it is not secret.
 */
export class LitellmCredentialTransportError extends Data.TaggedError(
  'LitellmCredentialTransportError',
)<{
  readonly credentialName: string;
  readonly reason: HttpClientErrorReason['_tag'] | 'Defect';
}> {
  override get message(): string {
    return (
      `LiteLLM.Credential "${this.credentialName}": a /credentials write failed ` +
      `(${this.reason}) before an answer could be read, so the credential MAY have been written. ` +
      'This error keeps neither the request nor its cause: the request body holds the credential ' +
      'values. Look the name up in LiteLLM. A row that landed is taken over by the next deploy ' +
      'with --adopt; one that did not is created by it.'
    );
  }
}

/**
 * The SDK prints request and response bodies to stderr while `DISTILLED_DEBUG_HTTP` is set, and a
 * `POST /credentials` carries the values in its body — refused before any request, exactly like
 * `key-secret.ts`'s `refuseDebugLogging` for `/key/generate`.
 */
export class LitellmCredentialDebugLoggingError extends Data.TaggedError(
  'LitellmCredentialDebugLoggingError',
)<{
  readonly credentialName: string;
}> {
  override get message(): string {
    return (
      `LiteLLM.Credential "${this.credentialName}": DISTILLED_DEBUG_HTTP is set, so the SDK ` +
      "would print the credential values to stderr in /credentials' request and response. Unset " +
      'it and run again. Nothing was written.'
    );
  }
}

/**
 * A write had to send the credential values and the deploying process does not hold one or more
 * of the declared variables. The names are listed, never a value.
 */
export class LitellmCredentialEnvUnsetError extends Data.TaggedError(
  'LitellmCredentialEnvUnsetError',
)<{
  readonly credentialName: string;
  readonly variables: readonly string[];
}> {
  override get message(): string {
    return (
      `LiteLLM.Credential "${this.credentialName}": ` +
      `the deploying process does not set ${this.variables.join(', ')}.`
    );
  }
}

/**
 * A credentials read answered something that is not a row of the credential table (or named a
 * different row), so adopt-by-name cannot trust it. The by-name read is this resource's only
 * read, so a row it cannot recognise is refused rather than guessed at.
 */
export class LitellmCredentialUnreadableError extends Data.TaggedError(
  'LitellmCredentialUnreadableError',
)<{
  readonly reason: string;
}> {
  override get message(): string {
    return `LiteLLM.Credential: a credentials read is unreadable (${this.reason}).`;
  }
}

/**
 * A create or update returned no error, yet the by-name read does not answer the credential — the
 * proxy failed to record it in memory or in the DB. Refused instead of reported as done.
 */
export class LitellmCredentialAbsentAfterWriteError extends Data.TaggedError(
  'LitellmCredentialAbsentAfterWriteError',
)<{
  readonly credentialName: string;
}> {
  override get message(): string {
    return (
      `LiteLLM.Credential "${this.credentialName}": the write returned no error but the ` +
      'credential is absent from the by-name read.'
    );
  }
}

/**
 * The write returned no error but the credential still differs from the declaration. The update
 * path this resource uses is a PATCH merge (credential.ts, credential-operations.ts) — or a
 * whole-row rewrite to drop a key — so a residual difference is refused here instead of being
 * reported as converged.
 */
export class LitellmCredentialNotConvergedError extends Data.TaggedError(
  'LitellmCredentialNotConvergedError',
)<{
  readonly credentialName: string;
  readonly fields: readonly string[];
}> {
  override get message(): string {
    return (
      `LiteLLM.Credential "${this.credentialName}": after the write it still differs from the ` +
      `declaration in ${this.fields.join(', ')}.`
    );
  }
}

/** A rewrite deleted the old row before its POST failed. Keep only the failure tag. */
export class LitellmCredentialRewriteError extends Data.TaggedError(
  'LitellmCredentialRewriteError',
)<{
  readonly credentialName: string;
  readonly reason: string;
}> {
  override get message(): string {
    return (
      `LiteLLM.Credential "${this.credentialName}": DELETE already ran, but the replacement ` +
      `POST failed (${this.reason}). The next deploy recreates the row if absent; keep all ` +
      'declared credential variables set. If the POST landed despite the failure, the next ' +
      'deploy reads and reconciles that row.'
    );
  }
}

export type CredentialError =
  | credentials.CreateCredentialCredentialsPostError
  | credentials.GetCredentialByNameCredentialsByNameCredentialNameGetError
  | credentials.UpdateCredentialCredentialsCredentialNamePatchError
  | credentials.DeleteCredentialCredentialsCredentialNameDeleteError
  | LitellmCredentialInvalidError
  | LitellmCredentialTransportError
  | LitellmCredentialRewriteError
  | LitellmCredentialDebugLoggingError
  | LitellmCredentialEnvUnsetError
  | LitellmCredentialUnreadableError
  | LitellmCredentialAbsentAfterWriteError
  | LitellmCredentialNotConvergedError;
