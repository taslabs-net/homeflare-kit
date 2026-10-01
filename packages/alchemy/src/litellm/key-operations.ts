/**
 * The four LiteLLM `/key/*` calls `LiteLLM.Key` uses, through the SDK's typed operations.
 *
 * ★ EVERY OPERATION HERE EXISTS IN `@distilled.cloud/litellm/key_management` (generated at LiteLLM
 *   1.103.0) AND IS CALLED WITH ITS OWN REQUEST TYPE — none is guessed, none is hand-rolled:
 *     `listKeysKeyListGet`        GET  /key/list      read, by `key_alias`, `return_full_object`
 *     `generateKeyFnKeyGeneratePost` POST /key/generate  create, with the user-defined `key`
 *     `updateKeyFnKeyUpdatePost`  POST /key/update    merge patch, found by `key_alias`
 *     `deleteKeyFnKeyDeletePost`  POST /key/delete    by `key_aliases`
 *   `/key/info` and `/v2/key/info` are NOT used: they take the key or its hash, and this resource
 *   holds neither for an adopted key. Listing by alias needs no value.
 * ⚠️ NO SEMAPHORE, unlike pass-through endpoints: every key is its own DB row (budget-operations.ts).
 * ⚠️ THE SDK'S DEFAULT RETRY APPLIES TO `/key/generate` TOO. A create whose response was lost and is
 *   then retried surfaces the proxy's duplicate-alias 400 rather than a second key; the next deploy
 *   reads the row. UNVERIFIED against a live proxy — the retry policy is core's, not this file's.
 * ⚠️ DELETE IS IDEMPOTENT BY THIS FUNCTION, not by the vendor. MEASURED in the litellm 1.103.0 wheel
 *   (`key_management_endpoints.py`): `/key/delete` for an alias it does not hold answers 404 "No keys
 *   found" (`delete_verification_tokens`, :4915-4918), and 403 for a caller that may not delete the
 *   key (:4933-4936). The SDK types both as resource-specific tags, `KeyNotFound` and
 *   `KeyDeleteForbidden` (a distilled patch, `patches/key_management/delete_key_fn_key_delete_post.json`,
 *   each matched on the status AND a phrase of the vendor's message), so `catchTag` sees them: the
 *   MESSAGE MATCH LIVES IN THE SDK, never here (S21). An absent alias is settled by the LIST, which
 *   answers absence unambiguously, and a `KeyNotFound` (another caller won the race, or a retry of a
 *   delete whose answer was lost) re-lists and is swallowed only if the key has gone since. Every
 *   other failure, `KeyDeleteForbidden` included, propagates typed: a 404 that is not the vendor's
 *   is core's `NotFound`, not absence. operations.ts's `deletePassThroughEndpoint` and
 *   budget-operations.ts decide the same way, on their own tag.
 */
import * as keys from '@distilled.cloud/litellm/key_management';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';
import { isHttpClientError } from 'effect/unstable/http/HttpClientError';
import {
  LitellmKeyAliasEmptyError,
  LitellmKeyAmbiguousAliasError,
  LitellmKeyTransportError,
  LitellmKeyUnreadableError,
} from './key-errors.ts';
import { type KeyAttributes, toAttributes } from './key-form.ts';
import { type LitellmOpContext, throughFetch } from './operations.ts';

/**
 * The one live key with this alias, or `undefined`. Two rows are an error, never a pick: the
 * server filters by an EXACT alias by default, and this filters again so a proxy that matched a
 * substring cannot hand back someone else's key.
 */
export const findKey = (
  keyAlias: string,
): Effect.Effect<
  KeyAttributes | undefined,
  | keys.ListKeysKeyListGetError
  | LitellmKeyUnreadableError
  | LitellmKeyAmbiguousAliasError
  | LitellmKeyAliasEmptyError,
  LitellmOpContext
> =>
  keyAlias.trim() === '' ? Effect.fail(new LitellmKeyAliasEmptyError()) : findKeyByAlias(keyAlias);

const findKeyByAlias = (keyAlias: string) =>
  findKeyRowByAlias(keyAlias).pipe(
    Effect.map((row) => (row === undefined ? undefined : toAttributes(row))),
  );

/**
 * The one live key with this alias, as the raw `/key/list` row — the shape `toAttributes` reads
 * and drops the `token` from. `findKey` maps it to `KeyAttributes`; `readKeyToken` reads the raw
 * row because the row's `token` (the vendor's sha256 of the key) is what key-secret.ts's
 * `verifyKeyValue` compares a declared value against, and it must not pass through `toAttributes`
 * (which would put the hash in state).
 */
const findKeyRowByAlias = (keyAlias: string) =>
  throughFetch(keys.listKeysKeyListGet({ key_alias: keyAlias, return_full_object: true })).pipe(
    Effect.flatMap((response) =>
      Effect.gen(function* () {
        const rows: readonly unknown[] = response.keys ?? [];
        // ⚠️ A STRING ROW IS A HASH: the proxy ignored `return_full_object`, and a hash carries none
        //   of the columns compared. Refused rather than read as "no key".
        if (rows.some((row) => typeof row !== 'object' || row === null)) {
          return yield* new LitellmKeyUnreadableError({ keyAlias });
        }
        const mine = (rows as readonly Record<string, unknown>[]).filter(
          (row) => row['key_alias'] === keyAlias,
        );
        if (mine.length > 1) {
          return yield* new LitellmKeyAmbiguousAliasError({ count: mine.length, keyAlias });
        }
        return mine[0];
      }),
    ),
  );

/**
 * The row's `token` (the vendor's sha256 of the key), `null` when the row carries none, or
 * `undefined` when the alias is absent. Absence must plan recreation, not a value mismatch.
 * Read only for the in-memory mismatch check (`verifyKeyValue`); the hash is never persisted.
 */
export const readKeyToken = (
  keyAlias: string,
): Effect.Effect<
  string | null | undefined,
  | keys.ListKeysKeyListGetError
  | LitellmKeyUnreadableError
  | LitellmKeyAmbiguousAliasError
  | LitellmKeyAliasEmptyError,
  LitellmOpContext
> =>
  keyAlias.trim() === ''
    ? Effect.fail(new LitellmKeyAliasEmptyError())
    : findKeyRowByAlias(keyAlias).pipe(
        Effect.map((row) =>
          row === undefined ? undefined : typeof row['token'] === 'string' ? row['token'] : null,
        ),
      );

/**
 * Whether `value` holds the request it answers. An `HttpClientError` does, through `reason.request`
 * (its `request` getter reads it), and its body is the JSON the call sent.
 */
const carriesRequest = (value: unknown): boolean =>
  isHttpClientError(value) || Predicate.hasProperty(value, 'request');

/**
 * `/key/generate`. The response's `key` is `Redacted` (the SDK's `SensitiveValue`); never log the response.
 * ⛔ THE REQUEST BODY IS `{"key":"sk-…"}`, AND A FAILED CALL CAN CARRY ITS REQUEST. Two ways, both
 *   measured 2026-09-29 with a synthetic key (key-transport.test.ts): a transport failure is an
 *   `HttpClientError` in the error channel, and a body that fails mid-read is the SAME error as a
 *   DEFECT (`Effect.orDie` in `@distilled.cloud/core`'s `protocol-rest.ts`). Either would put the
 *   plaintext in front of anything that serialises, inspects or logs the failure — while the SDK's
 *   own `HttpClientError` is not something this resource can leave typed as it is. Both become
 *   `LitellmKeyTransportError`, which keeps the alias and the reason's tag and nothing else.
 *   The SDK's status errors (`BadRequest`, `Forbidden`, …) carry only the proxy's message text and
 *   stay as they are, so a caller can still `catchTag` them.
 */
export const generateKey = (body: keys.GenerateKeyFnKeyGeneratePostRequest) => {
  const keyAlias = body.key_alias ?? '';
  return throughFetch(keys.generateKeyFnKeyGeneratePost(body)).pipe(
    Effect.catchTag('HttpClientError', (error) =>
      Effect.fail(new LitellmKeyTransportError({ keyAlias, reason: error.reason._tag })),
    ),
    Effect.catchDefect((defect) =>
      carriesRequest(defect)
        ? Effect.fail(
            new LitellmKeyTransportError({
              keyAlias,
              reason: isHttpClientError(defect) ? defect.reason._tag : 'Defect',
            }),
          )
        : Effect.die(defect),
    ),
  );
};

/** `/key/update`, found by the body's `key_alias`. */
export const updateKey = (body: keys.UpdateKeyFnKeyUpdatePostRequest) =>
  throughFetch(keys.updateKeyFnKeyUpdatePost(body)).pipe(Effect.asVoid);

/** `/key/delete` by alias, when the list shows the key; a no-op when it does not. */
export const deleteKey = (
  keyAlias: string,
): Effect.Effect<
  void,
  | keys.DeleteKeyFnKeyDeletePostError
  | keys.ListKeysKeyListGetError
  | LitellmKeyUnreadableError
  | LitellmKeyAmbiguousAliasError
  | LitellmKeyAliasEmptyError,
  LitellmOpContext
> =>
  findKey(keyAlias).pipe(
    Effect.flatMap((live) =>
      live === undefined
        ? Effect.void
        : throughFetch(keys.deleteKeyFnKeyDeletePost({ key_aliases: [keyAlias] })).pipe(
            Effect.asVoid,
            Effect.catchTag('KeyNotFound', (original) =>
              findKey(keyAlias).pipe(
                Effect.flatMap((still) =>
                  still === undefined ? Effect.void : Effect.fail(original),
                ),
              ),
            ),
          ),
    ),
  );
