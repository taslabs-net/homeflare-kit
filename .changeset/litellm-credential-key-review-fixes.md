---
'@homeflare/alchemy': patch
'@homeflare/distilled-litellm': patch
---

Harden `LiteLLM.Key` and `LiteLLM.Credential` against the review findings on their release PRs.

`LiteLLM.Credential`: a create onto a name another owner already holds is refused at apply, never overwritten (`refuseTakeover`, matching `LiteLLM.Key`); a `POST /credentials` that fails on the wire is a `LitellmCredentialTransportError` that keeps neither the request nor its cause (the body holds the values), and a create is refused while `DISTILLED_DEBUG_HTTP` is set (the SDK would print the values); the by-name read and delete `catchTag` the SDK's `CredentialNotFound` instead of `instanceof NotFound`, so a 404 from a front proxy or wrong base path stays an error rather than reading as absence. A changed row is now updated with `PATCH /credentials/{name}` (a merge by key) instead of a whole-row DELETE + POST, so a write that fails on the wire leaves the row in place — the DELETE + POST rewrite left no row when the POST failed after the DELETE. The one thing PATCH cannot do is remove a key, so a declaration that drops a previously-declared `credential_info` key is still a whole-row rewrite.

`LiteLLM.Key`: an adopted key whose declared `key: { fromEnv }` value is not the key the live row holds is refused (`LitellmKeyValueMismatchError`), compared only as a sha256 in memory against the row's `token` (`hash_token`) — never persisted, never in an error. `/key/update` cannot change a key's value, so a mismatch is nothing to write: fix the variable or drop the `key`.

`@homeflare/distilled-litellm`: the by-name read and delete now type their `404` as `CredentialNotFound` (matched on the vendor's `Credential not found`), so `catchTag` sees it; the credential PATCH now carries `credential_name` in its request body (a second member `credential_name_body`, wire-named `credential_name`) so it answers the vendor's `UpdateCredentialItem` instead of a 422.
