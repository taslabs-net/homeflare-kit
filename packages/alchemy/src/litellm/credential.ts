/**
 * `LiteLLM.Credential` — one row of LiteLLM's reusable credential table (`/credentials/*`), a
 * named bag of values the proxy stores encrypted and can bind to a deployment by `model_id`.
 *
 * ★ ADOPT BY NAME. `credentialName` finds the live row whose `credential_name` equals it; a live
 *   row with no state is `Unowned`, so it needs `--adopt`. The name is the vendor's only address
 *   (the table's unique column, `schema.prisma`), so a row is located by the by-name read and
 *   never guessed at.
 * ★ `defaultRemovalPolicy: 'retain'` — deleting a credential a deployment references would break
 *   that deployment's next call. Opt in with `.pipe(RemovalPolicy.destroy())`.
 * ⛔ THE VALUES ARE `{ fromEnv: 'NAME' }`, NEVER A VALUE (S25): LiteLLM STORES these literals
 *   (encrypted at rest), so the deploying process must hold them — credential-types.ts carries the
 *   full reasoning, and a `model` deployment's `os.environ/NAME` reference is the opposite case.
 *   A plan compares the live row's `credential_info` per declared key and the values through a
 *   digest of what was resolved (`valuesSeal`); it never compares the masked read, and a value
 *   whose variable is unset never drifts a plan-only environment (credential-values.ts).
 * ⚠️ A RENAME IS A REPLACE: the name is the row's identity and its only address, so a changed
 *   `credentialName` creates the new row and the old one survives under 'retain' — never renamed
 *   in place.
 * ⚠️ A CHANGED ROW IS PATCHED, NOT REWRITTEN — PATCH merges values and normally replaces DB
 *   info, but only merges in-memory info (1.103.0 credential_endpoints/endpoints.py:312-319,384-387).
 *   A failed PATCH leaves the row behind (review finding 3: DELETE + POST left NO row when POST
 *   failed). Dropping a value key OR an info key still requires DELETE + POST; both stores must
 *   converge. All refusals run before the first write. Every write reads back to prove removal.
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
  LitellmCredentialAbsentAfterWriteError,
  LitellmCredentialInvalidError,
  LitellmCredentialNotConvergedError,
} from './credential-errors.ts';
import {
  createBody,
  differing,
  firstProblem,
  literalValues,
  patchBody,
  removedInfoKeys,
  removedValueKeys,
} from './credential-form.ts';
import {
  createCredential,
  deleteCredential,
  readCredential,
  refuseDebugLogging,
  updateCredential,
} from './credential-operations.ts';
import type { CredentialAttributes, CredentialProps } from './credential-types.ts';
import { rewriteCredential } from './credential-rewrite.ts';
import { requireValues, resolveValues, sealValues, valuesState } from './credential-values.ts';

export type { CredentialAttributes, CredentialProps };
export type { CredentialError } from './credential-errors.ts';

export interface LiteLLMCredential extends Resource<
  'LiteLLM.Credential',
  CredentialProps,
  CredentialAttributes
> {}

export const LiteLLMCredential = Resource<LiteLLMCredential>('LiteLLM.Credential', {
  defaultRemovalPolicy: 'retain',
});

export const isLiteLLMCredential = (value: unknown): value is LiteLLMCredential =>
  Predicate.hasProperty(value, 'Type') && value.Type === 'LiteLLM.Credential';

const refuse = (props: CredentialProps) => {
  const problem = firstProblem(props);
  return problem === undefined
    ? Effect.void
    : Effect.fail(
        new LitellmCredentialInvalidError({
          problem,
          credentialName: String(props.credentialName),
        }),
      );
};

type Args<P> = {
  fqn: string;
  instanceId: string;
  output: CredentialAttributes | undefined;
} & P;

/** ⛔ TEST-ONLY EXPORT. Not on index.ts's barrel. */
export const credentialHandlers = {
  /**
   * ⛔ WITH NO `output` THIS IS ALCHEMY'S ADOPTION PROBE, AND THE ONLY PLAN-TIME HOOK A NEW
   *   CREDENTIAL GETS — so the refusals run here too, as a defect (mcp-server.ts's own rule: the
   *   cold-start probe must fail the plan, and a recovery read must degrade to "nothing
   *   recovered", which only a defect does).
   */
  read: ({ olds, output }: Args<{ olds: CredentialProps }>) =>
    Effect.gen(function* () {
      // SDK debug logging prints responses too; non-sensitive value keys can be unmasked.
      yield* refuseDebugLogging(olds.credentialName);
      const problem = output === undefined ? firstProblem(olds) : undefined;
      if (problem !== undefined) {
        return yield* Effect.die(
          new LitellmCredentialInvalidError({
            problem,
            credentialName: String(olds.credentialName),
          }),
        );
      }
      const found = yield* readCredential(olds.credentialName);
      if (found === undefined) return undefined;
      // A row cannot supply a digest of values it hides; state can.
      return output === undefined ? Unowned(found) : { ...found, valuesSeal: output.valuesSeal };
    }),

  diff: ({
    news,
    output,
  }: {
    news: Input<CredentialProps>;
    output: CredentialAttributes | undefined;
  }) =>
    Effect.gen(function* () {
      if (!isResolved(news)) return undefined;
      yield* refuse(news);
      if (output === undefined) return undefined;
      // The name is identity: a different declared name is a different row.
      if (news.credentialName !== output.credentialName) {
        return { action: 'replace', deleteFirst: false } as const;
      }
      // ⚠️ An unresolved value never drifts a plan (credential-values.ts's `unknown`): the gate
      //   is "not stale", the same shape mcp-server.ts uses, and the write below still demands
      //   the value when a write is actually being made.
      const state = valuesState(news, output.valuesSeal);
      // PATCH cannot remove value keys or in-memory info keys. Names alone prove drift.
      const removed = [...removedInfoKeys(output, news), ...removedValueKeys(output, news)];
      return differing(output, news).length === 0 && removed.length === 0 && state !== 'stale'
        ? ({ action: 'noop' } as const)
        : ({ action: 'update' } as const);
    }),

  reconcile: ({ fqn, instanceId, news, output }: Args<{ news: CredentialProps }>) =>
    Effect.gen(function* () {
      yield* refuse(news);
      yield* refuseDebugLogging(news.credentialName);
      const resolved = resolveValues(news);
      const before = yield* readCredential(news.credentialName);
      let sealed = output?.valuesSeal ?? '';

      if (before === undefined) {
        // ⛔ A CREATE IS A WHOLE-ROW WRITE, so it must hold every declared value.
        yield* requireValues(news, resolved);
        yield* createCredential(createBody(news, resolved));
        sealed = sealValues(resolved.values);
      } else {
        // ⛔ A LIVE ROW IS ONLY WRITTEN WHEN THIS STACK MAY OWN IT. A rename onto a name the proxy
        //   already holds runs here with `output: undefined` (a fresh replace's new generation) and
        //   `before` set to the FOREIGN row — the planner never probed the new identity, so this is
        //   the apply-time check key.ts's own reconcile makes, and without it a deploy-wide
        //   `--adopt` meant for something else would overwrite a row another owner relies on.
        yield* refuseTakeover(
          { fqn, instanceId, output },
          `LiteLLM.Credential ${news.credentialName}`,
        );
        // ⛔ PATCH FOR VALUE/INFO CHANGES, REWRITE TO DROP KEYS IN BOTH STORES. Unlike the
        // old unconditional rewrite (finding 3), failed PATCH leaves the row behind. A rewrite
        // still needs every declared value BEFORE DELETE so a partial environment cannot erase it.
        const removed = [...removedInfoKeys(before, news), ...removedValueKeys(before, news)];
        const infoDrift = differing(before, news).length > 0;
        const valuesStale = valuesState(news, sealed) === 'stale';
        if (removed.length > 0) {
          yield* requireValues(news, resolved);
          yield* rewriteCredential(createBody(news, resolved));
          sealed = sealValues(resolved.values);
        } else if (infoDrift || valuesStale) {
          if (valuesStale) yield* requireValues(news, resolved);
          yield* updateCredential(
            patchBody(news, valuesStale ? literalValues(resolved) : undefined),
          );
          if (valuesStale) sealed = sealValues(resolved.values);
        }
      }

      // ⛔ THE READ-BACK IS A SINGLE READ, ON PURPOSE, AND THE VENDOR CLOSES THE RACE. The by-name
      //   read walks the proxy's IN-MEMORY list, which a write that just returned has already
      //   reloaded: `create_credential` awaits `upsert_credentials` and the PATCH awaits its
      //   in-memory sync before answering (endpoints.py, 1.103.0), so a row written by THIS proxy
      //   is in memory by the time its write answers. A retry loop would only paper over a
      //   multi-proxy read that hit a peer which had not reloaded — and then the honest answer is
      //   the failure below, not a slow pretend. This is the same single-read stance key.ts takes.
      const after = yield* readCredential(news.credentialName);
      if (after === undefined) {
        return yield* Effect.fail(
          new LitellmCredentialAbsentAfterWriteError({ credentialName: news.credentialName }),
        );
      }
      const left = [
        ...differing(after, news),
        ...removedInfoKeys(after, news).map((key) => `credential_info.${key}`),
        ...removedValueKeys(after, news).map((key) => `credential_values.${key}`),
      ];
      if (left.length > 0) {
        return yield* Effect.fail(
          new LitellmCredentialNotConvergedError({
            fields: left,
            credentialName: news.credentialName,
          }),
        );
      }
      return { ...after, valuesSeal: sealed };
    }),

  delete: ({ output }: { output: CredentialAttributes }) => deleteCredential(output.credentialName),

  /** ⛔ EMPTY: adoption is an explicit act (`--adopt`), and no ownership mark exists to filter by. */
  list: () => Effect.succeed([]),
};

export const LiteLLMCredentialProvider = () =>
  Provider.effect(
    LiteLLMCredential,
    Effect.succeed(LiteLLMCredential.Provider.of(credentialHandlers)),
  );
