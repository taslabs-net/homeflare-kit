/**
 * The four LiteLLM `/budget/*` calls `LiteLLM.Budget` uses, through the SDK's typed operations.
 *
 * ★ READS GO THROUGH `/budget/list` (the whole table, a bare array), not `/budget/info`. Both
 *   answer `body: unknown` in the generated schema, and what `/budget/info` does for an id that is
 *   not there is unmeasured; a list answers absence unambiguously.
 * ⚠️ Unlike pass-through endpoints, each budget is its own DB row, so no semaphore.
 * ⚠️ DELETE is idempotent BY THIS FUNCTION: a `BadRequest` re-lists and is swallowed only when the
 *   id is genuinely absent, never on message text (pass-through `operations.ts`' rule).
 */
import * as budgets from '@distilled.cloud/litellm/budget_management';
import * as Effect from 'effect/Effect';
import { type LitellmOpContext, throughFetch } from './operations.ts';
import { type BudgetAttributes, toAttributes } from './budget-form.ts';
import { LitellmBudgetUnreadableError } from './budget-errors.ts';

export const listBudgets = (): Effect.Effect<
  readonly BudgetAttributes[],
  budgets.ListBudgetBudgetListGetError | LitellmBudgetUnreadableError,
  LitellmOpContext
> =>
  throughFetch(budgets.listBudgetBudgetListGet({})).pipe(
    // ⚠️ MEASURED with the fake: the SDK types this `{ body: unknown }` but hands a bare JSON array
    //   back as the array itself, so accept both shapes and refuse anything else.
    Effect.flatMap((response) => {
      const rows: unknown = Array.isArray(response)
        ? response
        : (response as { body?: unknown }).body;
      return Array.isArray(rows)
        ? Effect.succeed(rows.map((row) => toAttributes(row as Record<string, unknown>)))
        : Effect.fail(new LitellmBudgetUnreadableError({ budgetId: '*' }));
    }),
  );

export const createBudget = (body: budgets.PostNewBudgetBudgetNewRequest) =>
  throughFetch(budgets.postNewBudgetBudgetNew(body)).pipe(Effect.asVoid);

export const updateBudget = (body: budgets.UpdateBudgetBudgetUpdatePostRequest) =>
  throughFetch(budgets.updateBudgetBudgetUpdatePost(body)).pipe(Effect.asVoid);

export const deleteBudget = (id: string) =>
  throughFetch(budgets.deleteBudgetBudgetDeletePost({ id })).pipe(
    Effect.asVoid,
    Effect.catchTag('BadRequest', (original) =>
      listBudgets().pipe(
        Effect.flatMap((rows) =>
          rows.some((row) => row.budgetId === id) ? Effect.fail(original) : Effect.void,
        ),
      ),
    ),
  );
