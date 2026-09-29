/**
 * `LiteLLM.Budget` — one row of LiteLLM's `LiteLLM_BudgetTable` (`/budget/*`), the "tier" keys and
 * teams bind to (`hf-tier-*`).
 *
 * ★ MONITORING, NOT LIMITS (Tim, 2026-09-28): `softBudget` is the prop; `maxBudget` is a hard cap
 *   that 429s every caller and is refused without `maxBudgetReason` (budget-form.ts).
 * ★ ADOPT BY id. `budgetId` names the live row; without it a deterministic physical name is used.
 *   A foreign row with that id is `Unowned`, so it needs `--adopt`.
 * ★ `defaultRemovalPolicy: 'retain'` — deleting a budget row that keys still reference either
 *   fails or detaches them, and a detached key loses its rate limits. Opt in with
 *   `.pipe(RemovalPolicy.destroy())`.
 * ⛔ CLEARING A LIMIT: sent as an explicit `null`. If this LiteLLM merges with `exclude_none` the
 *   row keeps the old value; reconcile reads back and FAILS (`LitellmBudgetFieldNotClearedError`)
 *   rather than report a cleared cap. Unmeasured against a live proxy at 1.103.0.
 * ⛔ NO CREDENTIAL IS A PROP; `litellmProviders`' layer supplies `Credentials`.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import { createPhysicalName } from 'alchemy/PhysicalName';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';
import {
  LitellmBudgetFieldNotClearedError,
  LitellmBudgetHardCapUnjustifiedError,
} from './budget-errors.ts';
import {
  type BudgetAttributes,
  type BudgetProps,
  createBody,
  differing,
  isHardCapUnjustified,
  updateBody,
} from './budget-form.ts';
import { createBudget, deleteBudget, listBudgets, updateBudget } from './budget-operations.ts';

export type { BudgetAttributes, BudgetProps };
export type { BudgetError } from './budget-errors.ts';

export interface LiteLLMBudget extends Resource<'LiteLLM.Budget', BudgetProps, BudgetAttributes> {}

export const LiteLLMBudget = Resource<LiteLLMBudget>('LiteLLM.Budget', {
  defaultRemovalPolicy: 'retain',
});

export const isLiteLLMBudget = (value: unknown): value is LiteLLMBudget =>
  Predicate.hasProperty(value, 'Type') && value.Type === 'LiteLLM.Budget';

const refuseUnjustifiedCap = (props: BudgetProps) =>
  isHardCapUnjustified(props)
    ? Effect.fail(new LitellmBudgetHardCapUnjustifiedError({ budgetId: props.budgetId }))
    : Effect.void;

const idOf = (
  id: string,
  instanceId: string,
  props: BudgetProps,
  output: BudgetAttributes | undefined,
) =>
  output?.budgetId !== undefined
    ? Effect.succeed(output.budgetId)
    : props.budgetId !== undefined
      ? Effect.succeed(props.budgetId)
      : createPhysicalName({ id, instanceId, lowercase: true, maxLength: 64 });

type Args<P> = {
  id: string;
  instanceId: string;
  output: BudgetAttributes | undefined;
} & P;

/** ⛔ TEST-ONLY EXPORT. Not on index.ts's barrel. */
export const budgetHandlers = {
  read: ({ id, instanceId, olds, output }: Args<{ olds: BudgetProps }>) =>
    Effect.gen(function* () {
      const budgetId = yield* idOf(id, instanceId, olds, output);
      const live = (yield* listBudgets()).find((row) => row.budgetId === budgetId);
      if (live === undefined) return undefined;
      return output === undefined ? Unowned(live) : live;
    }),

  diff: ({ news, output }: { news: Input<BudgetProps>; output: BudgetAttributes | undefined }) =>
    Effect.gen(function* () {
      if (!isResolved(news)) return undefined;
      yield* refuseUnjustifiedCap(news);
      if (output === undefined) return undefined;
      // The id is identity: a different declared id is a different row.
      if (news.budgetId !== undefined && news.budgetId !== output.budgetId) {
        return { action: 'replace', deleteFirst: false } as const;
      }
      return differing(output, news).length === 0
        ? ({ action: 'noop' } as const)
        : ({ action: 'update' } as const);
    }),

  reconcile: ({ id, instanceId, news, output }: Args<{ news: BudgetProps }>) =>
    Effect.gen(function* () {
      yield* refuseUnjustifiedCap(news);
      const budgetId = yield* idOf(id, instanceId, news, output);
      const before = (yield* listBudgets()).find((row) => row.budgetId === budgetId);
      if (before === undefined) yield* createBudget(createBody(news, budgetId));
      else if (differing(before, news).length > 0) yield* updateBudget(updateBody(news, before));

      const after = (yield* listBudgets()).find((row) => row.budgetId === budgetId);
      if (after === undefined) {
        return yield* Effect.die(
          new Error(`LiteLLM.Budget ${budgetId}: write returned no error but the row is absent.`),
        );
      }
      const left = differing(after, news);
      if (left.length > 0) {
        return yield* Effect.fail(
          new LitellmBudgetFieldNotClearedError({ budgetId, fields: left }),
        );
      }
      return after;
    }),

  delete: ({ output }: { output: BudgetAttributes }) => deleteBudget(output.budgetId),

  list: () => Effect.succeed([]),
};

export const LiteLLMBudgetProvider = () =>
  Provider.effect(LiteLLMBudget, Effect.succeed(LiteLLMBudget.Provider.of(budgetHandlers)));
