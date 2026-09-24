---
'@homeflare/alchemy': patch
---

Fix a review finding on the `litellm/*` distilled migration (`@homeflare/distilled-litellm`'s
`CredentialsFromEnv`, S20): a missing or misspelled `LITELLM_PROXY_URL`/`LITELLM_PROXY_API_KEY`
used to die as an unrecoverable Effect defect and crash the whole engine, instead of the typed
`ConfigError` `LitellmOpError` already declared — a regression this migration made newly
reachable from `LiteLLM.PassThroughEndpoint`'s `read`/`reconcile`/`delete` (the retired
hand-rolled `credentials.ts` failed typed). Fixed at the source, per house rule: the distilled
`litellm` package's own `credentials.ts` no longer ends in `Effect.orDie`, copied forward into
`@homeflare/distilled-litellm` unchanged. No prop, attribute or public API changed.

`netbox/*`'s `CredentialsFromEnv` has the identical shape and is not fixed by this changeset —
tracked separately (`docs/upstream-conformance.md` finding 9).
