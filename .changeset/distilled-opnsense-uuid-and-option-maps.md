---
'@homeflare/distilled-opnsense': patch
---

Byte-copy of the distilled-side fix for two measured defects in the OPNsense
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

No kit `Resource`s consume this package yet (see `packages/alchemy/docs/
opnsense.md` — the family PR is separate and held for after this SDK PR
lands), so this release has no live-plan impact of its own.
