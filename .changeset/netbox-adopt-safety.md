---
'@homeflare/alchemy': patch
---

`Netbox.Prefix` no longer erases prose it did not declare.

🔴 **The bug, found by review rather than by an incident.** The resource sent `description: ''`
whenever the prop was absent. On a create that is invisible — the field was empty anyway. ⛔ On an
**adopt** it is data loss: NetBox is the estate's record of DECISIONS, so a prefix's description is
usually the only written trace of why that range exists. The first deploy that adopted one would
have PATCHed it to empty, `matches` would have reported drift, the plan would have said `update`,
and the diff would have read as converging a declaration rather than deleting a sentence.

★ **The tell was an inconsistency inside the same file, not a failure.** Optional foreign keys were
already omitted when undeclared, with a comment explaining that sending `null` would clear a tenant
somebody set in the UI. Free text had the identical hazard and the opposite treatment. Two fields,
one hazard, two answers — that gap is the defect.

★ **The line is now drawn at what the vendor itself defaults.** `status`, `is_pool` and
`mark_utilized` have defaults in NetBox's schema, so omitting one genuinely means "the default" and
settling it says what NetBox would have done anyway. `description`, `comments` and the optional
foreign keys have no such default — the schema's `''` is the absence of a value, not a decision —
so they are omitted from the body and left uncompared until declared.

⛔ **Whatever `matches` compares, `body` must send**, or the plan says `update` forever: the PATCH
omits the field, so the next read is unchanged. The two moved together here and
`prefix-form.test.ts` asserts the invariant.

⚠️ **The cost, stated:** prose can no longer be cleared by omission. Clearing it is
`description: ''`, written on purpose — the readable way to say a destructive thing.

`body` and `matches` are extracted to `prefix-form.ts` so both are pure functions a test can call
with a literal, the way the Proxmox families keep their `*-form.ts` beside the resource.
