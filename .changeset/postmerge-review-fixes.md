---
'@homeflare/alchemy': patch
---

Fix the review-seat findings on `Postgres.Grants` and `LiteLLM.Model` ahead of the `@homeflare/alchemy` release:

- `Postgres.Grants` `read` now records the revoker's superuser status, so a grant made by the object's owner counts as restorable only when the revoker is a superuser (the owner, as revoker, is already covered).
- `Postgres.Grants` `delete` no longer re-grants collateral: the revoke plan restores nothing, matching the "never re-grants" doctrine.
- `Postgres.Grants` `reconcile` into a dropped database fails with the typed `PostgresGrantsDatabaseMissing` instead of an untyped connect failure.
- `LiteLLM.Model` now exports `LitellmModelForeignRowError` and `LitellmModelConfigFileRowError` from `@homeflare/alchemy/litellm` (they were raised but not on the barrel).
