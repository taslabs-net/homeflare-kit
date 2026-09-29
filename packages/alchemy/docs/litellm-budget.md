# LiteLLM — `LiteLLM.Budget`

One row of LiteLLM's `LiteLLM_BudgetTable` (`/budget/*`): the "tier" that virtual keys and teams
bind to (`hf-tier-agent`, `hf-tier-interactive`, …). Typed calls come from
`@distilled.cloud/litellm/budget_management`; credentials and refusals are the family's, see
[litellm.md](./litellm.md).

## Monitoring, not limits

`max_budget` is a **hard cap**: LiteLLM's own field doc says "Requests will fail if this budget
(in USD) is exceeded". On 2026-09-28 an undeclared $60/day cap on `hf-tier-interactive` (made
through the API on 09-06, in no repo) 429'd every call of the claude2 fleet. So:

- `softBudget` is the prop to reach for: it "will NOT fail if this is exceeded" and fires the alert.
- `maxBudget` is **never defaulted**, and the plan is refused
  (`LitellmBudgetHardCapUnjustifiedError`) unless `maxBudgetReason` is set. The reason lives in the
  declaration, so a hard cap is a reviewed line of source, not an API side effect.

```ts
export class Interactive extends LiteLLMBudget('Interactive', {
  budgetId: 'hf-tier-interactive', // adopts the live row (needs --adopt)
  budgetDuration: '1d',
  softBudget: 60,
  rpmLimit: 60,
  tpmLimit: 6_000_000,
}) {}
```

Declaring an adopted hard tier **without** `maxBudget` clears the live cap: the update sends an
explicit `null` for every limit the declaration omits.

## Behaviour

| Concern     | Rule                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity    | `budgetId` (else a deterministic physical name). A different declared id is a `replace`.                                                                    |
| Adopt       | A live row with the id and no state is `Unowned`; needs `--adopt`.                                                                                          |
| Removal     | `defaultRemovalPolicy: 'retain'`. Opt in with `RemovalPolicy.destroy()`. Delete is idempotent: a `BadRequest` is swallowed only if a re-list shows it gone. |
| Read        | `/budget/list` (whole table). `rpm_limit`/`tpm_limit` come back as decimal strings (`BigInt?`), converted to numbers.                                       |
| Write check | Reconcile reads back; a limit the row still carries that the declaration dropped fails with `LitellmBudgetFieldNotClearedError`.                            |

## Version: distilled copy is 1.100.0, the proxy is 1.103.0

The SDK is generated at v1.100.0. For the budget routes the request bodies used here
(`budget_id`, `soft_budget`, `max_budget`, `budget_duration`, `rpm_limit`, `tpm_limit`) are all in
that schema. **Not measured against 1.103.0** (no live proxy read was made, and the source for it
is not cloned): whether `/budget/update` accepts an explicit `null` to clear a limit, and what
happens on create of an existing id. The fake models 400 for both. The read-back check above
exists so an `exclude_none` merge fails loudly instead of leaving a hard cap in place.

## Not modelled

`max_parallel_requests`, `model_max_budget` and `budget_reset_at`: the row read back
(`BudgetListItem`) does not carry them, so a declaration could never be diffed. Add them once a
read that returns them is measured. Keys and teams that reference a tier are separate resources.
