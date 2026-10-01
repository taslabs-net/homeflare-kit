/**
 * Where `LiteLLM.Key`'s secret comes from, and the only place it is unwrapped.
 *
 * ⛔ THE KEY VALUE IS WRITE-ONLY, THE SAME MECHANISM EVERY OTHER KIT SECRET USES
 *   (`../secrets/write-only.ts`: PBS webhook secrets, the Cloudflare MCP entry, Forgejo org secrets).
 *   The prop holds the NAME of an environment variable, `{ fromEnv: 'SEAT_KEY' }`; the deploying
 *   process reads it at call time; the value goes over the wire once, in `/key/generate`'s body.
 *   Alchemy persists props AND attributes unencrypted — a `Redacted` is TAGGED, not encrypted
 *   (`State/StateEncoding.ts` writes the inner value beside the tag) — so neither may hold it.
 *   S25 of the provider standard says the same; `MeshNode` (docs/mesh-node.md) is the other family
 *   that keeps a generated secret out of state.
 * ★ WHY NOT LET LITELLM MINT IT AND RETURN IT. `/key/generate` does return the new key, and the SDK
 *   decodes it `Redacted` (`T.SensitiveValue`). But a resource has exactly two places to put it, an
 *   attribute (state, in the clear) or nowhere; and LiteLLM never shows the plaintext again, only a
 *   hash. A key minted and dropped is a row nobody can use. So the value is minted OUTSIDE — a random
 *   `sk-…` in the vault, the same one the seat reads — and handed to LiteLLM, which the docstring
 *   for `key` supports: "User defined key value. Must start with 'sk-' and be at least 16
 *   characters long."
 * ⚠️ AN ADOPTED KEY'S VALUE IS COMPARED WITH THE LIVE ROW, IN MEMORY ONLY. LiteLLM keeps the sha256
 *   hex of the key (`hash_token`, measured in the 1.103.0 wheel's `proxy/utils.py`), and `/key/list`
 *   with `return_full_object` returns it as the row's `token`. When a declaration names `key:
 *   { fromEnv }` for a key that already exists, the resolved value is sha256'd and compared with that
 *   hash (never with the value, and the hash is never persisted — key-form.ts's `toAttributes` still
 *   drops `token`). A mismatch is refused (`LitellmKeyValueMismatchError`): a seat reading the same
 *   variable would hold a key that authenticates nothing while the plan reported success. There is
 *   nothing to WRITE about a mismatch — `/key/update` drops `key` from its body
 *   (`prepare_key_update_data` pops it, `key_management_endpoints.py:2469`), so it cannot change a
 *   key's value, and `/key/regenerate` is an Enterprise feature (its docstring, :5673) — so the
 *   operator fixes the variable or drops the `key`. A changed variable changes nothing on an
 *   existing key: rotate by declaring a new alias. Plan and reconcile both check a set variable;
 *   an unset or empty variable skips verification so a deployer need not hold the seat key.
 * ⚠️ A PROXY MAY REFUSE THE WHOLE APPROACH: with the dashboard's `disable_custom_api_keys` setting
 *   on, `/key/generate` answers 403 to ANY user-defined key ("Keys must be auto-generated",
 *   `_check_custom_key_allowed`, :485-496). That surfaces as the SDK's typed `Forbidden`. UNVERIFIED
 *   whether the estate's proxy has it on; adopting existing keys is unaffected.
 */
import { createHash } from 'node:crypto';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';
import { type FromEnv, resolveAll } from '../secrets/write-only.ts';
import {
  LitellmKeyDebugLoggingError,
  LitellmKeyValueMalformedError,
  LitellmKeyValueMismatchError,
  LitellmKeyValueMissingError,
  LitellmKeyValueRequiredError,
} from './key-errors.ts';

/** From `/key/generate`'s own docstring for the `key` field (distilled-litellm, LiteLLM 1.103.0). */
const PREFIX = 'sk-';
const MIN_LENGTH = 16;
/**
 * ⚠️ NO WHITESPACE is the house's own addition, not LiteLLM's: a secret renderer's trailing newline
 *   would be sent as part of the value, and a seat that trims what it reads would then hold a
 *   different key from the one LiteLLM stored (`resolveAll` deliberately does not trim).
 */
const RULE = `a user-defined key must start with '${PREFIX}', be at least ${MIN_LENGTH} characters and contain no whitespace`;

/**
 * The declared value, `Redacted`, or a typed refusal naming the alias, the variable and the rule.
 * Called only when a create is actually about to happen, never by `diff` or `read`, so a plan
 * (which needs no secret) runs without the variable.
 * ⚠️ AN EMPTY VARIABLE IS A MISSING ONE (`resolveAll`): a secret renderer that failed writes
 *   `NAME=` and sending `''` would create a key that authenticates with nothing.
 */
export const resolveKeyValue = (
  keyAlias: string,
  ref: FromEnv | undefined,
): Effect.Effect<
  Redacted.Redacted<string>,
  LitellmKeyValueRequiredError | LitellmKeyValueMissingError | LitellmKeyValueMalformedError
> =>
  Effect.gen(function* () {
    if (ref === undefined) return yield* new LitellmKeyValueRequiredError({ keyAlias });
    const variable = ref.fromEnv;
    const value = resolveAll({ key: ref }).values['key'];
    if (value === undefined) return yield* new LitellmKeyValueMissingError({ keyAlias, variable });
    if (!value.startsWith(PREFIX) || value.length < MIN_LENGTH || /\s/.test(value)) {
      return yield* new LitellmKeyValueMalformedError({ keyAlias, rule: RULE, variable });
    }
    return Redacted.make(value);
  });

/** Whether `/key/generate` echoed the value it was sent (the SDK hands it back `Redacted`). */
export const echoes = (
  returned: string | Redacted.Redacted<string>,
  sent: Redacted.Redacted<string>,
): boolean =>
  (Redacted.isRedacted(returned) ? Redacted.value(returned) : returned) === Redacted.value(sent);

/**
 * The sha256 hex of a key value, the same digest LiteLLM stores as `hash_token` (`proxy/utils.py`).
 * ★ MATCHES THE VENDOR'S HASH, not a house format: the row's `token` is the vendor's own store, so
 *   the digest must be reproducible from the value with the vendor's algorithm, not a salt (a salt
 *   would make every comparison fail). Nothing here is persisted — the value is in memory only.
 */
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Whether an ADOPTED key's declared `key: { fromEnv }` value is the key the live row holds.
 *
 * ⚠️ COMPARED AS A SHA256 AGAINST THE ROW'S `token`, never value-against-value, and the hash is
 *   never written anywhere: a `Redacted` value unwrapped only long enough to digest it, then gone.
 *   The row's `token` (`hash_token`) is the vendor's own sha256 hex of the key.
 */
export const verifyKeyValue = (
  keyAlias: string,
  ref: FromEnv | undefined,
  token: string | null,
): Effect.Effect<void, LitellmKeyValueMismatchError> =>
  Effect.gen(function* () {
    if (ref === undefined) return;
    const variable = ref.fromEnv;
    const value = resolveAll({ key: ref }).values['key'];
    if (value === undefined) return;
    if (token === null || sha256(value) !== token) {
      return yield* new LitellmKeyValueMismatchError({ keyAlias, variable });
    }
  });

/**
 * ⛔ THE SDK PRINTS BODIES WHILE `DISTILLED_DEBUG_HTTP` IS SET (`@distilled.cloud/core`
 *   `protocol-http.ts`: the first 400 characters of every request body; `protocol-rest.ts`: of every
 *   response), and `/key/generate` carries the key in both. Measured by reading the pinned source
 *   2026-09-29; `mesh-node-token.ts` refuses for the same reason. Only a create needs it: no other
 *   call in this resource carries the value. Reads `process.env` because that is what distilled reads.
 */
export const refuseDebugLogging = (
  keyAlias: string,
): Effect.Effect<void, LitellmKeyDebugLoggingError> =>
  (globalThis.process?.env?.['DISTILLED_DEBUG_HTTP'] ?? '') !== ''
    ? Effect.fail(new LitellmKeyDebugLoggingError({ keyAlias }))
    : Effect.void;

/** Whether verification can run; unset/empty variables skip the check, never a create. */
export const hasKeyValue = (ref: FromEnv | undefined): boolean =>
  ref !== undefined && resolveAll({ key: ref }).values['key'] !== undefined;
