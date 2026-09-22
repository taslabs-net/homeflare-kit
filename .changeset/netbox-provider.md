---
'@homeflare/alchemy': minor
---

A NetBox provider, generated from NetBox's own OpenAPI document — `@homeflare/alchemy/netbox`.

`Netbox.Prefix` declares one IP prefix and the decision recorded against it. It is the first object
class for three measurable reasons: `WritablePrefixRequest.required` is exactly `["prefix"]`, so it
is the only interesting NetBox object with **no foreign-key prerequisite** (a VLAN needs `vid` and
a group; a Device needs a role, a type and a site — four more Resources before the first one can be
declared); a prefix is the atom of what NetBox is for, the record of what the network was DECIDED
to be; and `status: 'deprecated'` is how a retired range stops being folklore in an SSH config
comment and becomes a line with a reviewable diff.

⛔ **The constraint tables are generated, never hand-typed.** `bun codegen/netbox.ts` reads NetBox
4.7.0's OpenAPI 3.0.3 document, verifies its sha256 against `codegen/manifest.json`, and emits the
committed tables plus `docs/netbox-coverage.md`. A key naming an endpoint the vendor does not have
stops the generator. This is the same pipeline that exists because a PBS deploy adopted ten objects
and then failed its one create on a `maxLength: 128` the generated type did not carry — NetBox gets
it **before** its first write rather than after.

⛔ **Two of NetBox's seven regexes are not JavaScript in meaning, and both compile cleanly.**
Measured over the whole document: `^[-\w]+$` (`slug`) and `^[\w.@+-]+$` (`username`). Python's `\w`
is Unicode on a `str`, so Django accepts `zürich-core` and a verbatim JavaScript copy refuses it —
a plan blaming the operator for a legal value, which is worse than the server-side 400 the table
replaces. ⚠️ The `u` flag does not fix it. Both are dropped, recorded as `patternSource` with no
`pattern`, and the generated header says nothing enforces them.

⚠️ **The document was pinned to the vendor's release tag, not read from an instance, and the
manifest says why.** The reference instance could not answer `/api/schema/`. The published document
was then cross-checked against a snapshot the estate took from its own instance while it was up:
1256 operations on each side, `(method, path)` sets identical with zero difference. ⛔ That verifies
the path surface only — the snapshot discards request bodies, which is the half this generates —
so every constraint rests on the vendor document alone.

Also here:

- Adopt-first by construction: `reconcile` locates before it writes, and ⛔ an ambiguous identity
  **fails** rather than binding to whichever row NetBox ordered first.
- 🔴 **One guessed filter shape was caught before it shipped, and the fix is structural.** The
  prefix locate first narrowed server-side with `vrf_id=null`, the sentinel NetBox uses for "no
  foreign key" — `FILTERS_NULL_CHOICE_VALUE = 'null'` is real. ⛔ But in the vendor's own source
  at v4.7.0, `PrefixFilterSet.vrf_id` is a plain `ModelMultipleChoiceFilter` with no `null_value`:
  it never opted in, so `'null'` fails queryset validation and NetBox answers **400 on every plan
  for every global-table prefix**. `locate` now sends only filters the document declares and a new
  `identifies` picks the row in this process, where the rule is readable and testable offline.
- `retain` on removal for every family, because deleting a NetBox row reparents children and
  detaches IP assignments; the `delete` handler is fully implemented anyway.
- Read/write shape asymmetry handled in `values.ts` — `status` is written as `"active"` and read
  back as `{value, label}`; a foreign key is written as `4` and read back as `{id, url, display}`.
  Comparing those directly reports drift on every plan, forever.
- ⛔ No credential is ever a prop. `NETBOX_URL` and `NETBOX_TOKEN` are read at call time, and
  `Authorization: Token`, not `Bearer` — a wrong scheme and a wrong credential look identical in
  the response.
- ★ **`codegen/param-rules.ts` gains a dialect table, and `emit.ts` is untouched.** There are
  exactly two vendor facts about a pattern — which dialect it is written in, and whether the
  vendor anchors it — so they live together per product rather than as a string every function
  switches on. ⛔ NetBox gets the Django translator and no anchoring: its own 7 patterns already
  carry `^…$` and Django validates with `re.search`, so re-anchoring would invent a rule. PVE is
  the opposite case and keeps its measured anchoring. Every existing Proxmox table regenerates
  byte-identical.
