---
'@homeflare/alchemy': patch
---

`Proxmox.HaRule`'s constraint table was empty and nothing said so.

MEASURED 2026-09-22: PVE spells `POST /cluster/ha/rules` as `parameters: {allOf: [{properties:
{rule}}, {oneOf: [node-affinity, resource-affinity]}]}` — a discriminated union. The apidoc reader
asked for `parameters.properties`, got `undefined`, and emitted `{}`. A wired family's plan-time
guard therefore checked **nothing**, and an empty table is indistinguishable from an endpoint whose
parameters happen to carry no rules. `comment` there has a `maxLength` of 4096 and `affinity` an
enum of two.

`codegen/parameters.ts` reads both combinators, and their logic is their meaning. `allOf` branches
all apply, so their properties MERGE — a key claimed by two branches would have to satisfy both,
which this does not compute, so it stops rather than picking one. `oneOf` branches are
ALTERNATIVES, so they INTERSECT: only what every branch states identically survives, because
enforcing a rule from one branch would refuse a legal declaration of the other kind. `nodes` and
`strict` exist only on node-affinity and are therefore not enforced. ⚠️ `optional` is intersected
toward optional rather than field-by-field: its ABSENCE means required, so dropping a disagreeing
`optional` would have read as required and refused every legal node-affinity rule, whose `affinity`
is optional where resource-affinity's is not.

⛔ And a parameter schema this file cannot read is now recorded as `unresolved` and **stops the
generator** for any endpoint this package writes to, rather than producing the empty table that hid
the problem. `tests/schema-manifest.test.ts` covers the reader directly.

⛔ `docs/api-coverage.*` had the identical blind spot from its own parser: it reported
`/cluster/ha/rules` as having **zero** parameters and zero gaps. `scripts/api-schema.ts` now reads
the combinators through the same resolver — 5 parameters, 2 unenforced, both `format` names.
⚠️ Two parsers for one file format is the deeper defect; merging them is its own change.
