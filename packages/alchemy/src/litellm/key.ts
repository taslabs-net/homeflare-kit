/**
 * `LiteLLM.Key` — one virtual key of LiteLLM's `LiteLLM_VerificationToken` (`/key/*`), bound to a
 * `LiteLLM.Budget` tier, with its value kept out of Alchemy state.
 *
 * ★ ADOPT BY ALIAS. `keyAlias` is the identity: `/key/update` and `/key/delete` find a key by it
 *   (their docstrings), and `/key/list` filters by it, so an existing key is taken over by declaring
 *   its alias, with no value in hand. A live key with no state is `Unowned` and needs `--adopt`; the
 *   apply re-checks it (`refuseTakeover`) for a create the planner could not probe — which is EVERY
 *   key declared with `budgetId: tier.budgetId`, an Output until the tier exists.
 * ⛔ THE VALUE IS WRITE-ONLY (key-secret.ts): `key: { fromEnv }` names the variable, the value goes
 *   over the wire once in `/key/generate`, and no attribute, log line or error carries it. `diff`
 *   and `read` never touch the environment, so a plan needs no secret.
 * ★ `defaultRemovalPolicy: 'retain'` — deleting a key breaks whatever holds it (a seat's every call
 *   401s). Dropping the declaration leaves the key live; `.pipe(RemovalPolicy.destroy())` opts in.
 * ⛔ A RENAME IS REFUSED, not replaced. The new key would need the same value, and `/key/generate`
 *   rejects a second key with a value it already holds; under `retain` the old row would still be
 *   there. Declare the new alias as a new resource and destroy the old one.
 * ★ A DECLARATION MANAGES ONLY WHAT IT NAMES (key-form.ts): an omitted prop is never compared or sent,
 *   and `metadata` is a merge (key-metadata.ts), so an adopted key's scope, budget and guardrails are
 *   never cleared by leaving them out.
 * ⛔ NO CREDENTIAL IS A PROP; `litellmProviders`' layer supplies `Credentials`.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';
import { refuseTakeover } from '../ownership/adopt.ts';
import {
  LitellmKeyAbsentAfterWriteError,
  LitellmKeyAliasChangedError,
  LitellmKeyFieldNotAppliedError,
  LitellmKeyValueNotHonouredError,
} from './key-errors.ts';
import {
  type KeyAttributes,
  type KeyProps,
  createBody,
  differing,
  updateBody,
} from './key-form.ts';
import { callbackSlotsIn } from './key-metadata.ts';
import {
  LitellmKeyCallbackMetadataDeclaredError,
  LitellmKeyCallbackMetadataLiveError,
} from './key-metadata-errors.ts';
import { deleteKey, findKey, generateKey, readKeyToken, updateKey } from './key-operations.ts';
import { echoes, refuseDebugLogging, resolveKeyValue, verifyKeyValue } from './key-secret.ts';

export type { KeyAttributes, KeyProps };
export type { KeyError } from './key-errors.ts';

export interface LiteLLMKey extends Resource<'LiteLLM.Key', KeyProps, KeyAttributes> {}

export const LiteLLMKey = Resource<LiteLLMKey>('LiteLLM.Key', { defaultRemovalPolicy: 'retain' });

export const isLiteLLMKey = (value: unknown): value is LiteLLMKey =>
  Predicate.hasProperty(value, 'Type') && value.Type === 'LiteLLM.Key';

/** The row with the memo the row cannot carry: what this provider last wrote for `duration`. */
const remembering = (live: KeyAttributes, output: KeyAttributes | undefined): KeyAttributes => ({
  ...live,
  duration: output?.duration ?? null,
});

/**
 * What state remembers of `duration` after a write: the declaration when it names one, else what it
 * remembered (`before`, `undefined` for a key just created). The row carries only `expires`.
 */
const remembered = (news: KeyProps, before: KeyAttributes | undefined): string | null =>
  news.duration !== undefined ? news.duration : (before?.duration ?? null);

/**
 * The `metadata` refusals that need no write to know (key-metadata.ts): a declaration that names a
 * callback slot, and — given the live row — a metadata write onto a key that holds one.
 */
const refuseMetadata = (news: KeyProps, live: KeyAttributes | undefined) =>
  Effect.gen(function* () {
    const declared = callbackSlotsIn(news.metadata);
    if (declared.length > 0) {
      return yield* new LitellmKeyCallbackMetadataDeclaredError({
        keyAlias: news.keyAlias,
        slots: declared,
      });
    }
    if (
      live !== undefined &&
      live.withheld.length > 0 &&
      differing(live, news).includes('metadata')
    ) {
      return yield* new LitellmKeyCallbackMetadataLiveError({
        keyAlias: news.keyAlias,
        slots: live.withheld,
      });
    }
  });

/**
 * Create the key, then prove LiteLLM stored the value it was sent.
 * ⛔ A PROXY THAT MINTS ITS OWN VALUE INSTEAD leaves a row nobody can authenticate with, reported as
 *   a success. `/key/generate` echoes the key (`Redacted`, never logged); a different one is deleted
 *   again and refused. UNVERIFIED that any proxy does this — the 1.103.0 docstring says the value is
 *   honoured — but a key nobody holds is not a failure to discover later.
 */
const createKey = (news: KeyProps) =>
  Effect.gen(function* () {
    yield* refuseDebugLogging(news.keyAlias);
    const secret = yield* resolveKeyValue(news.keyAlias, news.key);
    const created = yield* generateKey(createBody(news, secret));
    if (echoes(created.key, secret)) return;
    const removed = yield* deleteKey(news.keyAlias).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    return yield* new LitellmKeyValueNotHonouredError({ keyAlias: news.keyAlias, removed });
  });

/** ⛔ TEST-ONLY EXPORT. Not on index.ts's barrel. */
export const keyHandlers = {
  read: ({ olds, output }: { olds: KeyProps; output: KeyAttributes | undefined }) =>
    Effect.gen(function* () {
      const live = yield* findKey(output?.keyAlias ?? olds.keyAlias);
      if (live === undefined) return undefined;
      return output === undefined ? Unowned(live) : remembering(live, output);
    }),

  diff: ({ news, output }: { news: Input<KeyProps>; output: KeyAttributes | undefined }) =>
    Effect.gen(function* () {
      if (!isResolved(news)) return undefined;
      yield* refuseMetadata(news, output);
      if (output === undefined) return undefined;
      if (news.keyAlias !== output.keyAlias) {
        return yield* new LitellmKeyAliasChangedError({ from: output.keyAlias, to: news.keyAlias });
      }
      return differing(output, news).length === 0
        ? ({ action: 'noop' } as const)
        : ({ action: 'update' } as const);
    }),

  reconcile: ({
    fqn,
    instanceId,
    news,
    output,
  }: {
    fqn: string;
    instanceId: string;
    news: KeyProps;
    output: KeyAttributes | undefined;
  }) =>
    Effect.gen(function* () {
      const alias = news.keyAlias;
      yield* refuseMetadata(news, undefined);
      const found = yield* findKey(alias);
      const before = found === undefined ? undefined : remembering(found, output);
      if (before === undefined) {
        yield* createKey(news);
      } else {
        yield* refuseTakeover({ fqn, instanceId, output }, `LiteLLM.Key ${alias}`);
        // ⚠️ AN ADOPTED KEY'S DECLARED VALUE IS CHECKED AGAINST THE ROW (key-secret.ts's header):
        //   only when `key: { fromEnv }` names a variable, only as a sha256 in memory, and nothing
        //   is written about a mismatch (`/key/update` cannot change a key's value). No `key` declared
        //   means no extra read: `readKeyToken` is a `/key/list`, and an omitted value is never held.
        if (news.key !== undefined) {
          yield* verifyKeyValue(alias, news.key, yield* readKeyToken(alias));
        }
        yield* refuseMetadata(news, before);
        if (differing(before, news).length > 0) yield* updateKey(updateBody(news, before));
      }

      const after = yield* findKey(alias);
      if (after === undefined)
        return yield* new LitellmKeyAbsentAfterWriteError({ keyAlias: alias });
      // ★ THE MEMO IS THE DECLARATION when it names a `duration` (else what state already remembered):
      //   a write that reached here carried `duration` whenever the expiry differed, so what is left
      //   to check is the row itself (and whether it HAS an expiry).
      const settled = { ...after, duration: remembered(news, before) };
      const left = differing(settled, news);
      if (left.length > 0) {
        return yield* new LitellmKeyFieldNotAppliedError({ fields: left, keyAlias: alias });
      }
      return settled;
    }),

  delete: ({ output }: { output: KeyAttributes }) => deleteKey(output.keyAlias),

  /**
   * ⚠️ ENUMERATES NOTHING, ON PURPOSE. `nuke` walks `list` and deletes what it finds; a proxy's key
   *   table holds every live credential the estate's services authenticate with, plus dashboard
   *   session keys nobody declared — none of which this stack made.
   */
  list: () => Effect.succeed([]),
};

export const LiteLLMKeyProvider = () =>
  Provider.effect(LiteLLMKey, Effect.succeed(LiteLLMKey.Provider.of(keyHandlers)));
