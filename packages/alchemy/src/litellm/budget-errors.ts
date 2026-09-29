/**
 * The typed refusals `LiteLLM.Budget` raises on top of `@distilled.cloud/litellm`'s own SDK errors.
 */
import type * as budgets from '@distilled.cloud/litellm/budget_management';
import * as Data from 'effect/Data';

/** A `maxBudget` (a HARD cap: LiteLLM answers 429 once it is spent) declared with no reason. */
export class LitellmBudgetHardCapUnjustifiedError extends Data.TaggedError(
  'LitellmBudgetHardCapUnjustifiedError',
)<{
  readonly budgetId: string | undefined;
}> {}

/**
 * The write returned no error but the row still carries a limit the declaration does not.
 * `/budget/update` may merge with `exclude_none` (the way `/config/pass_through_endpoint` does),
 * in which case a limit can never be cleared by an update. Refused, never claimed as done.
 */
export class LitellmBudgetFieldNotClearedError extends Data.TaggedError(
  'LitellmBudgetFieldNotClearedError',
)<{
  readonly budgetId: string;
  readonly fields: readonly string[];
}> {}

/** `/budget/info` answered something that is not a list of budget rows. */
export class LitellmBudgetUnreadableError extends Data.TaggedError('LitellmBudgetUnreadableError')<{
  readonly budgetId: string;
}> {}

export type BudgetError =
  | budgets.PostInfoBudgetBudgetInfoError
  | budgets.PostNewBudgetBudgetNewError
  | budgets.UpdateBudgetBudgetUpdatePostError
  | budgets.DeleteBudgetBudgetDeletePostError
  | LitellmBudgetHardCapUnjustifiedError
  | LitellmBudgetFieldNotClearedError
  | LitellmBudgetUnreadableError;
