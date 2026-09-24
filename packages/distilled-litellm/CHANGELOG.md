# @homeflare/distilled-litellm

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
