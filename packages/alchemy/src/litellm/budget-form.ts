/**
 * Props, wire bodies and comparison for `LiteLLM.Budget`, testable without a server.
 *
 * ⛔ NO SILENT `max_budget`. LiteLLM's own field doc: "Requests will fail if this budget (in USD)
 *   is exceeded" — a hard cap. On 2026-09-28 an undeclared $60/day `max_budget` on
 *   `hf-tier-interactive` 429'd the whole claude2 fleet. So `maxBudget` is never defaulted and is
 *   refused unless `maxBudgetReason` says why; `softBudget` is the monitoring field (it "will NOT
 *   fail if this is exceeded", it fires the alert).
 * ⚠️ NOT MODELLED: `max_parallel_requests`, `model_max_budget`, `budget_reset_at`. The row read
 *   back (`BudgetListItem`, generated at LiteLLM 1.100.0) has none of them, so a declaration of
 *   them could never be diffed. Add them when a read that returns them is measured.
 */
import type * as budgets from '@distilled.cloud/litellm/budget_management';

export interface BudgetProps {
  /** Live budget id. Set it to adopt an existing row (`hf-tier-agent`); default is a deterministic physical name. */
  readonly budgetId?: string;
  /** Alert threshold in USD. Requests keep flowing when exceeded. The monitoring field. */
  readonly softBudget?: number;
  /** HARD cap in USD: requests fail (429) once spent. Refused unless `maxBudgetReason` is set. */
  readonly maxBudget?: number;
  /** Why a hard cap is wanted. Required with `maxBudget`; recorded in the declaration only. */
  readonly maxBudgetReason?: string;
  /** Reset period, e.g. `'1d'`, `'28d'`. */
  readonly budgetDuration?: string;
  /** Requests per minute. */
  readonly rpmLimit?: number;
  /** Tokens per minute. */
  readonly tpmLimit?: number;
}

export interface BudgetAttributes {
  readonly budgetId: string;
  readonly softBudget: number | null;
  readonly maxBudget: number | null;
  readonly budgetDuration: string | null;
  readonly rpmLimit: number | null;
  readonly tpmLimit: number | null;
}

/** Declared field → wire field. The single list every comparison and body walks. */
const FIELDS = [
  ['softBudget', 'soft_budget'],
  ['maxBudget', 'max_budget'],
  ['budgetDuration', 'budget_duration'],
  ['rpmLimit', 'rpm_limit'],
  ['tpmLimit', 'tpm_limit'],
] as const;

export const isHardCapUnjustified = (props: BudgetProps): boolean =>
  props.maxBudget !== undefined && (props.maxBudgetReason ?? '').trim() === '';

/** Create body: only what is declared. */
export const createBody = (
  props: BudgetProps,
  budgetId: string,
): budgets.PostNewBudgetBudgetNewRequest => {
  const body: Record<string, unknown> = { budget_id: budgetId };
  for (const [prop, wire] of FIELDS) if (props[prop] !== undefined) body[wire] = props[prop];
  return body as budgets.PostNewBudgetBudgetNewRequest;
};

/** Update body: declared fields, plus an explicit `null` for a live limit the declaration dropped. */
export const updateBody = (
  props: BudgetProps,
  live: BudgetAttributes,
): budgets.UpdateBudgetBudgetUpdatePostRequest => {
  const body: Record<string, unknown> = { budget_id: live.budgetId };
  for (const [prop, wire] of FIELDS) {
    if (props[prop] !== undefined) body[wire] = props[prop];
    else if (live[prop] !== null) body[wire] = null;
  }
  return body as budgets.UpdateBudgetBudgetUpdatePostRequest;
};

/** Wire names of the fields where live and declared disagree. */
export const differing = (live: BudgetAttributes, props: BudgetProps): readonly string[] =>
  FIELDS.filter(([prop]) => live[prop] !== (props[prop] ?? null)).map(([, wire]) => wire);

const numberOrNull = (value: unknown): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value);

/**
 * One row of `/budget/info`. `tpm_limit`/`rpm_limit` are `BigInt?` in LiteLLM's schema and come
 * back as decimal strings (the generated `BudgetListItem` says so), hence `Number()`.
 */
export const toAttributes = (row: Record<string, unknown>): BudgetAttributes => ({
  budgetDuration: typeof row['budget_duration'] === 'string' ? row['budget_duration'] : null,
  budgetId: String(row['budget_id']),
  maxBudget: numberOrNull(row['max_budget']),
  rpmLimit: numberOrNull(row['rpm_limit']),
  softBudget: numberOrNull(row['soft_budget']),
  tpmLimit: numberOrNull(row['tpm_limit']),
});
