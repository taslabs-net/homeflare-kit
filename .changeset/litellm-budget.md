---
'@homeflare/alchemy': minor
---

Add `LiteLLM.Budget`, the first LiteLLM resource beyond pass-through endpoints. It declares a budget tier with `softBudget` as the monitoring field, never defaults `max_budget`, and refuses a hard `maxBudget` without a `maxBudgetReason`. It adopts existing tier rows by id and defaults to `retain` on removal.
