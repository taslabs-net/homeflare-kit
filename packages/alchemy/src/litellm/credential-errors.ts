/**
 * The typed refusals `LiteLLM.Credential` raises on top of `@distilled.cloud/litellm`'s own SDK
 * errors.
 *
 * ⛔ NO MESSAGE HERE MAY CARRY A CREDENTIAL VALUE: only the credential's NAME, field names, the
 *   NAMES of environment variables, and SDK error text — exactly like mcp-server-errors.ts.
 * ⚠️ THE SDK'S TYPED UNION IS NARROW ON PURPOSE, and the runtime is wider: the credential routes
 *   declare only `UnprocessableEntity` (422) in `credential_management.ts`, so a create on an
 *   existing name — which the live 1.103.0 container answers `409` (`endpoints.py`'s
 *   `_credential_exists_detail`) — decodes at run time as the core `Conflict` class, and the
 *   reads'/delete's `404` as core `NotFound` (`Errors.ts` re-exports both, but neither appears in
 *   the operation's TS union). credential-operations.ts tests those classes with `instanceof`, and
 *   `CredentialError` carries the typed members of the FOUR operations the resource calls
 *   (create, by-name read, delete — and the PATCH is never called, credential-operations.ts); the
 *   runtime classes surface through the engine as `LitellmOpError`'s runtime members, never
 *   silently swallowed (S21).
 */
import type * as credentials from '@distilled.cloud/litellm/credential_management';
import * as Data from 'effect/Data';

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
 * path this resource uses is a whole-row rewrite (credential.ts, credential-operations.ts), so a
 * residual difference is refused here instead of being reported as converged.
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

export type CredentialError =
  | credentials.CreateCredentialCredentialsPostError
  | credentials.GetCredentialByNameCredentialsByNameCredentialNameGetError
  | credentials.DeleteCredentialCredentialsCredentialNameDeleteError
  | LitellmCredentialInvalidError
  | LitellmCredentialEnvUnsetError
  | LitellmCredentialUnreadableError
  | LitellmCredentialAbsentAfterWriteError
  | LitellmCredentialNotConvergedError;
