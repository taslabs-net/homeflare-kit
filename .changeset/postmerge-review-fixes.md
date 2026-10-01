---
'@homeflare/alchemy': patch
---

Fix the review-seat findings on `Postgres.Grants` and `LiteLLM.Model` ahead of the `@homeflare/alchemy` release:

- `Postgres.Grants` `read` now records whether the revoker can act as the object's owner (`pg_has_role(current_user, relowner, 'USAGE')`), so a grant made by the object's owner counts as restorable when the revoker is the owner, a superuser, or a member of the owning role — and is dropped otherwise, instead of the revoker's superuser status alone deciding.
- `Postgres.Grants` `delete` re-grants collateral the table's revoke would otherwise clear, matching the "never re-grants" doctrine (the earlier wording claimed the opposite; the revoke plan restores the collateral it removes).
- `Postgres.Grants` `reconcile` into a dropped database fails with the typed `PostgresGrantsDatabaseMissing` instead of an untyped connect failure.
- `LiteLLM.Model` now exports `LitellmModelForeignRowError` and `LitellmModelConfigFileRowError` from `@homeflare/alchemy/litellm` (they were raised but not on the barrel).
