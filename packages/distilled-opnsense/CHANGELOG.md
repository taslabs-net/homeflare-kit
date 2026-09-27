# @homeflare/distilled-opnsense

## 0.3.0

### Minor Changes

- [#264](https://github.com/taslabs-net/homeflare-kit/pull/264) [`a2a4818`](https://github.com/taslabs-net/homeflare-kit/commit/a2a4818226d2c672c3a96132231f8ff09ae2cbf4) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Byte-copy of the distilled-side fix for two measured defects in the OPNsense
  converter (never hand-edited here — see `packages/alchemy/docs/
distilled-interim.md`'s route), both cited to `opnsense-core@26.7.2` source:

  **OPNSENSE-1 — `get` dropped `uuid`.** `getItemAction($uuid = null)` made
  `GetCategoryRequest`/`GetGroupRequest` an empty struct with no path param,
  even though a caller CAN supply uuid to fetch one real item (the official
  API reference documents exactly this: `GET firewall/alias/get_item
$uuid=null`) — the bare route without it falls through to a blank item
  template instead (`ApiMutableModelControllerBase::getBase`). Every
  `get<Item>` operation across all 8 covered controllers now carries `uuid`
  as a required `httpLabel`.

  **OPNSENSE-2 — option/select fields typed as plain strings.** Any field
  whose FieldType resolves to `BaseListField::getNodeData()` (or a
  `BaseSetField` field with `<AsList>Y</AsList>`) sends its GET response as
  an option map `{key: {value, selected}}`, not a string — the exact crash
  the live homeflare-network import hit (`value.trim is not a function`).
  Single-item get and whole-model get now decode those fields as
  `map<string, OptionEntry>` (`OptionEntry = {value: string; selected:
number}`); write bodies and search rows are unaffected (OPNsense sends
  those as plain/enum strings on both sides already — `UIModelGrid.php`'s
  `getValue()`, `setNodes()`'s plain scalar).

  Both fixed in the converter and regenerated, never hand-patched in output.
  Cross-checked against OPNsense's own documented API reference generator
  (`opnsense-docs`'s AST-based `ApiParser`, not this converter's regex one):
  every endpoint/method/param it reports for these 8 controllers is now
  either generated or explicitly skipped with a reason — a repeatable check
  (`scripts/inventory-check/` in the distilled clone), not a one-off, also
  found and fixed a reporting gap where several bespoke actions (`export`,
  `reconfigure`, `list_*`, ...) were silently invisible to the converter's
  own coverage log.

  Operation count is unchanged (83); only the affected request/response
  shapes changed. `scripts/smoke.ts` now also exercises
  `firewall_category.getCategory({uuid})` (OPNSENSE-1: asserts the built URL
  carries the uuid segment) and a `profile` option-map field on
  `quagga_general.get`'s response (OPNSENSE-2: asserts it decodes as
  `{value, selected}` entries, not a string).

  **`minor`, not `patch`**: for this 0.x package, a GET response field
  changing type from `string` to a map, and `get<Item>` gaining a required
  `uuid` path label, are both breaking shape changes for any consumer
  decoding these responses.

  **This is not a no-op release**: the already-merged `opnsense/*` family
  (PR [#236](https://github.com/taslabs-net/homeflare-kit/issues/236), `Opnsense.Firewall.Alias`/`Opnsense.Firewall.Group`) consumes
  this package's `get()` through `fetchLive` — this repo's bun workspace
  links `@distilled.cloud/opnsense` to this local package regardless of its
  declared `npm:` alias version, so that family's own pre-push gate caught
  the shape change immediately. See the sibling `@homeflare/alchemy`
  changeset in this same PR for the compatibility fix that keeps it
  decoding correctly, and its note on when that fix actually reaches a
  published `@homeflare/alchemy` consumer (the alias pin bump is a
  follow-up PR, not this one).

## 0.2.0

### Minor Changes

- [#198](https://github.com/taslabs-net/homeflare-kit/pull/198) [`20f1b42`](https://github.com/taslabs-net/homeflare-kit/commit/20f1b424795d22ac8116c70b3e7895f249275a60) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `@homeflare/distilled-opnsense`, an unmodified copy of the (not yet
  upstream-published) `@distilled.cloud/opnsense` SDK — 83 operations across 8
  API controllers (Firewall Alias/Category/Group/Filter, Routing Gateways, the
  `os-frr` plugin's Quagga/BGP), generated from OPNsense's own MVC model XML
  and API controller PHP (`opnsense/core`/`opnsense/plugins` tag `26.7.2` —
  OPNsense publishes no OpenAPI document at all, so this converter reads the
  vendor's model/controller source directly, unlike every other
  distilled-sourced package in this kit). Typed, `catchTag`-able errors cover
  OPNsense's three-shape 200-with-failure vendor pattern plus its genuine
  non-2xx shapes.

  This is the fourth package on the kit's interim-package route established by
  `@homeflare/distilled-netbox` — see `packages/alchemy/docs/distilled-interim.md`.
  This PR does not alias `@distilled.cloud/opnsense` onto it and does not
  declare any Alchemy `Resource`s on top — that is a follow-up PR, gated in
  part on two open intent questions in `docs/alchemy-ledger-network.md` in the
  landscape repo.

  The kit's own typecheck (real, unlike the distilled clone's repo-wide
  `noCheck`) and `scripts/smoke.ts` caught two bugs never exercised before:
  `errors.ts`'s `Schema.Record({key, value})` used the wrong call shape for
  this `effect` rc, and `credentials.ts`'s `normalizeBaseUrl` doubled every
  request's path to `/api/api/...` (the same class of bug netbox's own
  `normalizeBaseUrl` review caught, PR [#183](https://github.com/taslabs-net/homeflare-kit/issues/183)). Both are fixed here and in the
  distilled clone.
