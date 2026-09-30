---
'@homeflare/distilled-litellm': minor
---

Type `POST /key/delete`'s 404 and 403 as resource-specific errors. LiteLLM answers an absent alias with 404 `No keys found` and a caller that may not delete a key with 403 `You are not authorized to delete this key` (`delete_verification_tokens`, read in the 1.103.0 wheel), but the operation declared only 400 and 422, so both surfaced at runtime as core's `NotFound` and `Forbidden`, outside its error type. `deleteKeyFnKeyDeletePost` now carries `KeyNotFound` and `KeyDeleteForbidden`, each matched on the status and a phrase of the vendor's message, so `catchTag` sees them. From a distilled patch, not an edit to generated files.
