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
 * ⚠️ A CHANGED ROW IS PATCHED, NOT REWRITTEN — a PATCH merges by key, so a value or `info` drift
 *   is an atomic merge that a failed call leaves the row behind (review finding 3: the old
 *   DELETE + POST left NO row when the POST failed after the DELETE). The ONE thing PATCH cannot
 *   do is REMOVE a key, so a declaration that drops a previously-declared `info` key is still a
 *   whole-row rewrite (the vendor's own delete, DB-authoritative and idempotent, then create).
 *   Every write reads back so a dropped field fails the deploy.
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
} from './credential-form.ts';
import {
  createCredential,
  deleteCredential,
  readCredential,
  updateCredential,
} from './credential-operations.ts';
import type { CredentialAttributes, CredentialProps } from './credential-types.ts';
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
      // A dropped info key is a removal the PATCH merge cannot do, so it plans an update too.
      const removed = removedInfoKeys(output, news);
      return differing(output, news).length === 0 && removed.length === 0 && state !== 'stale'
        ? ({ action: 'noop' } as const)
        : ({ action: 'update' } as const);
    }),

  reconcile: ({ fqn, instanceId, news, output }: Args<{ news: CredentialProps }>) =>
    Effect.gen(function* () {
      yield* refuse(news);
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
        // ⛔ PATCH FOR A VALUE/INFO DRIFT, WHOLE-ROW REWRITE ONLY TO DROP A KEY. The PATCH merges by
        //   key and leaves the row in place if it fails on the wire (finding 3). It cannot remove a
        //   key, so a declaration that drops a previously-declared `info` key is the one case still
        //   rewritten — and a rewrite that would send only half the declared values is refused
        //   first (`requireValues`), the same guard a create takes.
        const removed = removedInfoKeys(output, news);
        const infoDrift = differing(before, news).length > 0;
        const valuesStale = valuesState(news, sealed) === 'stale';
        if (removed.length > 0) {
          yield* requireValues(news, resolved);
          yield* deleteCredential(news.credentialName);
          yield* createCredential(createBody(news, resolved));
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
      const left = differing(after, news);
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
