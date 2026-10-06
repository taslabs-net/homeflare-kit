# @homeflare/distilled-litellm

## 0.4.1

### Patch Changes

- [#359](https://github.com/taslabs-net/homeflare-kit/pull/359) [`f43b0a5`](https://github.com/taslabs-net/homeflare-kit/commit/f43b0a5673d3660181b3dc7eb5342096c67cd38c) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Move to effect and `@effect/*` 4.0.1, alchemy 2.0.0-beta.81 and `@distilled.cloud/*` 1.0.0-rc.13. Consumers must install effect 4.0.1 (the peer was an exact rc.115): every import path moves from `effect/unstable/*` to `effect/*`. The distilled packages implement the `parseError` option distilled core rc.13 now requires of a REST protocol, raising each package's own `<Sdk>ParseError`. alchemy beta.81 probes a create whose props were Outputs at apply, so the ownership layer now answers `Unowned` to that apply-time read unless the plan proved the resume, forgets the row the engine's refusal leaves behind, and `Release.Binary` judges that create as a create: another owner's object, or other bytes at a binary path, are still refused without `--adopt`. `@homeflare/config` publishes the new `ESTATE_VERSIONS`.

## 0.4.0

### Minor Changes

- [#331](https://github.com/taslabs-net/homeflare-kit/pull/331) [`de03144`](https://github.com/taslabs-net/homeflare-kit/commit/de03144d46fa766afe64e471aaa75a64f0f06d8c) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Type `POST /key/delete`'s 404 and 403 as resource-specific errors. LiteLLM answers an absent alias with 404 `No keys found` and a caller that may not delete a key with 403 `You are not authorized to delete this key` (`delete_verification_tokens`, read in the 1.103.0 wheel), but the operation declared only 400 and 422, so both surfaced at runtime as core's `NotFound` and `Forbidden`, outside its error type. `deleteKeyFnKeyDeletePost` now carries `KeyNotFound` and `KeyDeleteForbidden`, each matched on the status and a phrase of the vendor's message, so `catchTag` sees them. From a distilled patch, not an edit to generated files.

### Patch Changes

- [#347](https://github.com/taslabs-net/homeflare-kit/pull/347) [`9ac49b5`](https://github.com/taslabs-net/homeflare-kit/commit/9ac49b5e54b3c287c2fcf59378eeef0d4f878778) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Harden `LiteLLM.Key` and `LiteLLM.Credential` against the review findings on their release PRs.

  `LiteLLM.Credential`: a create onto a name another owner already holds is refused at apply, never overwritten (`refuseTakeover`, matching `LiteLLM.Key`); a `POST /credentials` that fails on the wire is a `LitellmCredentialTransportError` that keeps neither the request nor its cause (the body holds the values), and a create is refused while `DISTILLED_DEBUG_HTTP` is set (the SDK would print the values); the by-name read and delete `catchTag` the SDK's `CredentialNotFound` instead of `instanceof NotFound`, so a 404 from a front proxy or wrong base path stays an error rather than reading as absence. A changed row is now updated with `PATCH /credentials/{name}` (a value-key merge with full intended info) instead of a whole-row DELETE + POST, so a write that fails on the wire leaves the row in place — the DELETE + POST rewrite left no row when the POST failed after the DELETE. Removing value keys or in-memory info keys requires a whole-row rewrite. Reconcile refuses debug logging and missing required values before DELETE. Info is the complete intended map, including on adoption, so undeclared live info keys are deliberately removed. PATCH normally replaces DB info but only merges memory info; it sends the full intended map.

  `LiteLLM.Key`: an owned or adopted key whose declared `key: { fromEnv }` value is not the key the live row holds is refused (`LitellmKeyValueMismatchError`), compared only as a sha256 in memory against the row's `token` (`hash_token`) — never persisted, never in an error. `/key/update` cannot change a key's value, so a mismatch is nothing to write: fix the variable or rotate with a new alias. Alchemy beta.79 calls the effectful diff even for unchanged props, so an environment-only rotation is refused during plan. Unset/empty variables skip verification for an existing key, allowing settings updates without the seat key; creates still require the value.

  `@homeflare/distilled-litellm`: the by-name read and delete now type their `404` as `CredentialNotFound` (matched on the vendor's `Credential not found`), so `catchTag` sees it; the credential PATCH now carries `credential_name` in its request body (a second member `credential_name_body`, wire-named `credential_name`) so it answers the vendor's `UpdateCredentialItem` instead of a 422.

  Walked against LiteLLM 1.103.0 `proxy/credential_endpoints/endpoints.py:312–319,384–387` and Alchemy 2.0.0-beta.79 `src/Provider.ts:274–289`, `src/Plan.ts:1503–1527`. Regression tests exercise real Plan/Apply and SDK encoding; the fake models separate DB/memory semantics, records PATCH bodies, requires the body name (422), and uses the vendor 404 error envelope.

  An owned key deleted outside the stack now plans an update and is recreated using its declared variable; only a live row is checked for a value mismatch. A credential rewrite whose POST fails after DELETE reports `LitellmCredentialRewriteError`, explicitly identifies the completed DELETE, and explains that the next deploy recreates an absent row. Regression tests cover dashboard deletion with a models change, live mismatches, and failed rewrite recovery through real Plan/Apply.

## 0.3.0

### Minor Changes

- [#325](https://github.com/taslabs-net/homeflare-kit/pull/325) [`3257c69`](https://github.com/taslabs-net/homeflare-kit/commit/3257c6982763974be31902e6921ef3d32a2fcaf4) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Regenerate from LiteLLM v1.103.0 (was v1.100.0): 964 operations across 91
  service modules, from the proxy's own `app.openapi()` dumped at tag `v1.103.0`
  and cross-checked byte for byte against the tag's committed dashboard types.

  ⚠️ **Removed modules.** LiteLLM moved the routes of fifteen per-provider
  `* Pass-through` tags under one `llm_passthrough` tag, so `anthropic_pass_through`,
  `assembly_ai_eu_pass_through`, `assembly_ai_pass_through`,
  `aws_comprehend_medical_pass_through`, `azure_ai_pass_through`,
  `azure_pass_through`, `bedrock_pass_through`, `cohere_pass_through`,
  `cursor_pass_through`, `google_ai_studio_pass_through`, `milvus_pass_through`,
  `mistral_pass_through`, `vertex_ai_pass_through`, `vllm_pass_through` and
  `watsonx_pass_through` no longer exist, and `Services.llmPassthrough` is new
  (`open_ai_pass_through` shrank from 10 to 5 operations). The kit's own
  consumers use only `budget_management` and `misc`.

  Typed request bodies for `POST /rerank`, `/v1/rerank`, `/v2/rerank`
  (`model`, `query`, `documents` required, plus the vendor's optional rerank
  parameters) and `POST /mcp-rest/tools/call` (`name` required, `server_id`,
  `arguments`). LiteLLM's handlers read the raw request body, so its OpenAPI
  document declares none and these requests were `S.Struct({})`; the bodies come
  from distilled patches grounded in the v1.103.0 source, not from edits to
  generated files. Responses stay `body: unknown`. The existing `400`/`403`/`404`/
  `409` error patches were re-measured against v1.103.0: every patched status is
  still raised.

## 0.2.0

### Minor Changes

- [#201](https://github.com/taslabs-net/homeflare-kit/pull/201) [`d7353b5`](https://github.com/taslabs-net/homeflare-kit/commit/d7353b5ff9748ebe7a5c0640ab6e06879d575203) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `@homeflare/distilled-litellm`, an unmodified copy of the (not yet
  upstream-published) `@distilled.cloud/litellm` SDK — 928 operations across
  105 LiteLLM Proxy API tags, generated from the vendor's own `app.openapi()`
  document pinned to tag `v1.100.0`, with typed `catchTag`-able errors for
  every status the spec declares, plus the undeclared `400`/`403`/`404`/`409`
  responses this package's own source-reading found on the primary CRUD
  routes of the five admin tags `homeflare-kit`'s `docs/litellm.md` flagged
  as "DB-backed, API-managed, but no kit resource yet" (`model_management`,
  `key_management`, `team_management`, `internal_user_management`,
  `budget_management`) — each patch cites the exact pinned-source file:line
  it is grounded in. `GenerateKeyResponse.key` and `NewUserResponse.key`, the
  literal virtual-key value `/key/generate`, `/key/regenerate` and `/user/new`
  return, now decode to `Redacted.Redacted<string>` rather than a plain
  `string`.

  This follows the kit's interim-package route for every distilled-sourced
  vendor SDK that isn't upstream yet — see
  `packages/alchemy/docs/distilled-interim.md`. This PR does not alias
  `@distilled.cloud/litellm` onto anything and does not add or move any of
  the kit's own resources — the alias can only resolve once this package is
  actually on npm; consuming it is a follow-up PR.
