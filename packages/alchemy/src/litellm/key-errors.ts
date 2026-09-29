/**
 * The typed refusals `LiteLLM.Key` raises on top of `@distilled.cloud/litellm`'s own SDK errors.
 *
 * ⛔ NOT ONE OF THESE CARRIES A KEY VALUE. They name the alias, the environment VARIABLE and the
 *   rule broken, never what the variable held: an error is logged, retried and pasted into a PR.
 *   The SDK's own errors are the other half: `generateKey` (key-operations.ts) turns the one that
 *   holds the request, and so the value, into `LitellmKeyTransportError` below.
 */
import type * as keys from '@distilled.cloud/litellm/key_management';
import * as Data from 'effect/Data';
import type { HttpClientErrorReason } from 'effect/unstable/http/HttpClientError';

/** A create is needed and the declaration names no `key` — LiteLLM would mint a value nobody holds. */
export class LitellmKeyValueRequiredError extends Data.TaggedError('LitellmKeyValueRequiredError')<{
  readonly keyAlias: string;
}> {
  override get message(): string {
    return (
      `LiteLLM.Key '${this.keyAlias}' does not exist and declares no \`key\`. Creating it would ` +
      'mint a value nobody holds. Declare `key: { fromEnv: "NAME" }`, or adopt an existing key.'
    );
  }
}

/**
 * distilled prints request and response BODIES to stderr while `DISTILLED_DEBUG_HTTP` is set, and
 * `/key/generate` carries the key in both. Refused before any request, as `fetchMeshNodeToken` does.
 */
export class LitellmKeyDebugLoggingError extends Data.TaggedError('LitellmKeyDebugLoggingError')<{
  readonly keyAlias: string;
}> {
  override get message(): string {
    return (
      `LiteLLM.Key '${this.keyAlias}': DISTILLED_DEBUG_HTTP is set, so the SDK would print the ` +
      "key to stderr in /key/generate's request and response. Unset it and run again. Nothing was written."
    );
  }
}

/**
 * `/key/generate` failed on the wire (or its answer could not be read), so nobody knows whether the
 * key exists.
 *
 * ⛔ THIS IS WHAT STANDS IN FOR AN `HttpClientError`, WHICH CARRIES ITS REQUEST, AND THE REQUEST BODY
 *   OF `/key/generate` IS `{"key":"sk-…"}`. Measured 2026-09-29 with a synthetic value: on a dropped
 *   connection `JSON.stringify(error)`, `Bun.inspect(error, { depth: 10 })` and Effect's JSON logger
 *   all printed the key, and so did the failure of a deploy over it. A defect from reading a broken
 *   answer (`protocol-rest.ts` reads it with `Effect.orDie`) carries the same request. So `reason` is
 *   the `HttpClientError` reason's TAG (a string) and nothing else is kept: no request, no cause, no
 *   description (a cause is free text from `fetch`).
 */
export class LitellmKeyTransportError extends Data.TaggedError('LitellmKeyTransportError')<{
  readonly keyAlias: string;
  readonly reason: HttpClientErrorReason['_tag'] | 'Defect';
}> {
  override get message(): string {
    return (
      `LiteLLM.Key '${this.keyAlias}': the /key/generate request failed (${this.reason}) before an ` +
      'answer could be read, so the key MAY have been created. This error keeps neither the request ' +
      "nor its cause: the request body holds the key's value. Look for the alias in LiteLLM. A key " +
      'that landed is taken over by the next deploy with --adopt; one that did not is created by it.'
    );
  }
}

/** An empty alias: `/key/list` would read `key_alias=` as no filter, and nothing could find the key again. */
export class LitellmKeyAliasEmptyError extends Data.TaggedError('LitellmKeyAliasEmptyError')<{}> {
  override get message(): string {
    return "LiteLLM.Key: keyAlias is empty. The alias is the key's identity. Nothing was written.";
  }
}

/** `key: { fromEnv }` names a variable the deploying process does not have (or has empty). */
export class LitellmKeyValueMissingError extends Data.TaggedError('LitellmKeyValueMissingError')<{
  readonly keyAlias: string;
  readonly variable: string;
}> {
  override get message(): string {
    return (
      `LiteLLM.Key '${this.keyAlias}': the environment variable ${this.variable} is unset or empty ` +
      'in the deploying process. Nothing was written.'
    );
  }
}

/** The variable's value breaks the rule `/key/generate` states for a user-defined key. */
export class LitellmKeyValueMalformedError extends Data.TaggedError(
  'LitellmKeyValueMalformedError',
)<{
  readonly keyAlias: string;
  readonly variable: string;
  readonly rule: string;
}> {
  override get message(): string {
    return (
      `LiteLLM.Key '${this.keyAlias}': the value of ${this.variable} is not usable — ${this.rule}. ` +
      'Nothing was written.'
    );
  }
}

/**
 * `/key/generate` answered with a different value than the one sent, so the row exists under a
 * key nobody holds. `removed` says whether the row was deleted again on the way out.
 */
export class LitellmKeyValueNotHonouredError extends Data.TaggedError(
  'LitellmKeyValueNotHonouredError',
)<{
  readonly keyAlias: string;
  readonly removed: boolean;
}> {
  override get message(): string {
    const outcome = this.removed
      ? 'The row was deleted again.'
      : 'The row could NOT be deleted again: remove it by hand.';
    return (
      `LiteLLM.Key '${this.keyAlias}': /key/generate answered with a different value than the one ` +
      `sent, so the key would authenticate nobody. ${outcome}`
    );
  }
}

/**
 * The alias is the identity: `/key/update` and `/key/delete` find a key by it, and this resource
 * never holds the value that could find it any other way. A different alias is a different key.
 */
export class LitellmKeyAliasChangedError extends Data.TaggedError('LitellmKeyAliasChangedError')<{
  readonly from: string;
  readonly to: string;
}> {
  override get message(): string {
    return (
      `LiteLLM.Key alias changed from '${this.from}' to '${this.to}'. The alias is the key's ` +
      'identity and a rename would need the same value under a new row: declare the new alias as ' +
      'a new resource and remove the old one with RemovalPolicy.destroy(). Nothing was written.'
    );
  }
}

/** More than one live key carries the alias, so nothing can say which one is declared. */
export class LitellmKeyAmbiguousAliasError extends Data.TaggedError(
  'LitellmKeyAmbiguousAliasError',
)<{
  readonly keyAlias: string;
  readonly count: number;
}> {
  override get message(): string {
    return (
      `LiteLLM.Key '${this.keyAlias}': ${this.count} live keys carry this alias, so none can be ` +
      'called the declared one. Resolve the duplicates in LiteLLM first. Nothing was written.'
    );
  }
}

/** `/key/list` answered something that is not a list of key rows. */
export class LitellmKeyUnreadableError extends Data.TaggedError('LitellmKeyUnreadableError')<{
  readonly keyAlias: string;
}> {
  override get message(): string {
    return (
      `LiteLLM.Key '${this.keyAlias}': /key/list did not answer full key rows (a hash list means ` +
      'return_full_object was ignored). Nothing was written.'
    );
  }
}

/** A write returned no error but the alias is not listed afterwards. */
export class LitellmKeyAbsentAfterWriteError extends Data.TaggedError(
  'LitellmKeyAbsentAfterWriteError',
)<{
  readonly keyAlias: string;
}> {
  override get message(): string {
    return `LiteLLM.Key '${this.keyAlias}': the write returned no error but the alias is not listed.`;
  }
}

/**
 * The write returned no error but the row still differs from the declaration. `/key/update` is a
 * merge patch (its docstring), so this is a proxy that did not apply a field — refused, never
 * reported as done.
 */
export class LitellmKeyFieldNotAppliedError extends Data.TaggedError(
  'LitellmKeyFieldNotAppliedError',
)<{
  readonly keyAlias: string;
  readonly fields: readonly string[];
}> {
  override get message(): string {
    return (
      `LiteLLM.Key '${this.keyAlias}': the write returned no error but ${this.fields.join(', ')} ` +
      'still differ from the declaration.'
    );
  }
}

export type KeyError =
  | keys.ListKeysKeyListGetError
  | keys.GenerateKeyFnKeyGeneratePostError
  | keys.UpdateKeyFnKeyUpdatePostError
  | keys.DeleteKeyFnKeyDeletePostError
  | LitellmKeyDebugLoggingError
  | LitellmKeyTransportError
  | LitellmKeyAliasEmptyError
  | LitellmKeyValueRequiredError
  | LitellmKeyValueMissingError
  | LitellmKeyValueMalformedError
  | LitellmKeyValueNotHonouredError
  | LitellmKeyAliasChangedError
  | LitellmKeyAmbiguousAliasError
  | LitellmKeyUnreadableError
  | LitellmKeyAbsentAfterWriteError
  | LitellmKeyFieldNotAppliedError;
