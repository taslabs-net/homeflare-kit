# @homeflare/distilled-netbox

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
