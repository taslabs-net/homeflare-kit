# @homeflare/distilled-litellm

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
