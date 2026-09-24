# @homeflare/distilled-netbox

## 0.3.0

### Minor Changes

- [#197](https://github.com/taslabs-net/homeflare-kit/pull/197) [`f3ddf4b`](https://github.com/taslabs-net/homeflare-kit/commit/f3ddf4be875c81f791545cbd5f53c71d95fd9beb) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Stamped `smithy.api#paginated` on all 140 NetBox list operations, so every
  `Services.<module>.list*` operation now has `.pages()` / `.items()`.

  NetBox's list endpoints answer `{count, next, previous, results}` with
  `next`/`previous` as full URLs (DRF `LimitOffsetPagination`), not a bare
  token core's generic pagination strategies (`paginateCursor`/
  `paginateToken`/`paginatePageNumber`) can follow — each one writes the raw
  `outputToken` value straight back into the next request's typed input, and
  a URL there would be sent verbatim as a query value instead of advancing
  the page. Since the URL's query params ARE the operation's own declared
  `limit`/`offset` input members (verified identical across all 140 list
  operations), a hand-written `netboxPaginate` strategy (`src/pagination.ts`)
  parses `next`'s query string and merges those params back onto the typed
  input instead — the same provider-local `PaginationStrategy` override
  `@distilled.cloud/cloudflare`'s `cloudflarePaginate` uses for its own
  generic-dispatcher gap.

  `netboxPaginate` groups `next`'s query entries by key rather than
  last-write-wins, so a multi-select filter (`tag`, `id`, `contact`, ...) —
  which NetBox echoes back as repeated same-key pairs, e.g. `id=1&id=2` —
  survives onto every later page intact instead of collapsing to its last
  value.

  Copied forward from the distilled clone (`homeflare/netbox` branch,
  `packages/netbox` — not pushed upstream, per decision 42) per
  `packages/alchemy/docs/distilled-interim.md`. `types` and `scripts/smoke.ts`
  (extended to follow a synthetic two-page `next` chain — including a
  multi-valued `id` filter — end-to-end through the packed tarball) both
  pass.

## 0.2.0

### Minor Changes

- [#183](https://github.com/taslabs-net/homeflare-kit/pull/183) [`0ff5a6a`](https://github.com/taslabs-net/homeflare-kit/commit/0ff5a6a167636af8662d9d6d803d6b9d0b7ba87e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `@homeflare/distilled-netbox`, an unmodified copy of the (not yet
  upstream-published) `@distilled.cloud/netbox` SDK — 1,256 operations across
  13 NetBox API tags, generated from NetBox's own committed OpenAPI 3.0.3
  document pinned to `v4.7.0` (the release this estate's NetBox on CT100
  runs), with typed `catchTag`-able errors for 404/403/400/409/etc, including
  the ones NetBox's document omits but its DRF stack produces uniformly.

  This establishes the kit's interim-package route for every distilled-sourced
  vendor SDK that isn't upstream yet — see
  `packages/alchemy/docs/distilled-interim.md`. This PR does not alias
  `@distilled.cloud/netbox` onto it and does not move any of the kit's
  existing hand-written `packages/alchemy/src/netbox/*` resources — the alias
  can only resolve once this package is actually on npm; that migration is a
  follow-up PR.
