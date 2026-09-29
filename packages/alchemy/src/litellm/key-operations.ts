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
 *   found" (`delete_verification_tokens`, :4914-4918), and 403 for a caller that may not delete the
 *   key (:4933-4936) — statuses the SDK's delete operation does not declare (its distilled patch
 *   adds 400 only, `patches/key_management/delete_key_fn_key_delete_post.json`; the runtime tags
 *   are still `NotFound`/`Forbidden`, measured with the fake). So an absent alias is settled by the
 *   LIST, which answers absence unambiguously, and a delete that FAILS re-lists and is swallowed only
 *   if the key has gone since — whatever the status, never on message text (S21; operations.ts's
 *   `deletePassThroughEndpoint` and budget-operations.ts decide the same way).
 */
import * as keys from '@distilled.cloud/litellm/key_management';
import * as Effect from 'effect/Effect';
import {
  LitellmKeyAliasEmptyError,
  LitellmKeyAmbiguousAliasError,
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
        return mine[0] === undefined ? undefined : toAttributes(mine[0]);
      }),
    ),
  );

/** `/key/generate`. The response's `key` is `Redacted` (the SDK's `SensitiveValue`); never log the response. */
export const generateKey = (body: keys.GenerateKeyFnKeyGeneratePostRequest) =>
  throughFetch(keys.generateKeyFnKeyGeneratePost(body));

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
            Effect.catch((original) =>
              findKey(keyAlias).pipe(
                Effect.flatMap((still) =>
                  still === undefined ? Effect.void : Effect.fail(original),
                ),
              ),
            ),
          ),
    ),
  );
