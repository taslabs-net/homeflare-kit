# Alchemy changelog archive 13

[Current changelog](../../CHANGELOG.md) · [Archive index](./README.md)

### Patch Changes

- [#113](https://github.com/taslabs-net/homeflare-kit/pull/113) [`4fe8cef`](https://github.com/taslabs-net/homeflare-kit/commit/4fe8cef3154ad0f373b291f413dcbd570602e6fa) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Proxmox.HaRule`'s constraint table was empty and nothing said so.

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

- [#116](https://github.com/taslabs-net/homeflare-kit/pull/116) [`54479fc`](https://github.com/taslabs-net/homeflare-kit/commit/54479fc7792076fb0e718b55588cc815823818c2) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Netbox.Prefix` no longer erases prose it did not declare.

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

## 0.16.0

### Minor Changes

- [#110](https://github.com/taslabs-net/homeflare-kit/pull/110) [`9fa5800`](https://github.com/taslabs-net/homeflare-kit/commit/9fa5800c8a1d2d3fb831d29ae64e9145e82fe48f) Thanks [@taslabs-net](https://github.com/taslabs-net)! - A NetBox provider, generated from NetBox's own OpenAPI document — `@homeflare/alchemy/netbox`.

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

### Patch Changes

- [#108](https://github.com/taslabs-net/homeflare-kit/pull/108) [`6586b0d`](https://github.com/taslabs-net/homeflare-kit/commit/6586b0decb5201e57f9e086619d1f658e5bce94d) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Adversarial review of the vendor-constraint guard, same day it shipped: two rule kinds were passing
  through it unchecked, and the coverage report did not know the guard existed.

  ⛔ **PVE anchors every pattern and the tables did not.** MEASURED read-only on a cluster node,
  `/usr/share/perl5/PVE/JSONSchema.pm:1636`: `if ($value !~ m/^$pattern$/)`. The published pattern is
  the INSIDE of an anchored match — PVE ships `[A-Za-z][A-Za-z0-9\-\_]+` for a firewall alias name —
  and `RegExp.test` is a search, so `ok name!` matched on its `ok`, planned clean and was rejected by
  PVE with the 400 the guard exists to prevent. All eleven PVE patterns in the tables were toothless
  this way. The anchoring is textual rather than `(?:…)`, because Perl's is: three of PVE's 72
  patterns carry a top-level `|`, and `^a|b$` is not `^(?:a|b)$`. `\n?` before the `$` is Perl's `$`,
  which matches before a final newline where JavaScript's does not — without it the guard would refuse
  values PVE accepts, which is worse than the 400. PBS is untouched: all 37 of its patterns already
  carry their own `^…$` and Rust's `is_match` is a search.

  ⛔ **An array states its rules on `items`, and the emitter read only the parameter.** 30 tabled
  parameters are arrays and 11 state real limits one level down — PBS `target` (2–32 chars, a name
  pattern), `associated-key`, the `delete` enums, PVE `secondary-controllers` (max 64). `violations`
  was already checking every element of a repeated key against a row that had no rules in it. Those
  rules now merge into the row, which says `each: true`; `required` is never taken from `items`.

  ⛔ **`patternFlags` is emitted instead of discarded.** `translatePattern` lifts PBS's leading `(?m)`
  to a flag and the first generation returned it and threw it away, so a multi-line rule would have
  been enforced with single-line semantics. No tabled endpoint uses one today; this is the guard for
  the day one does.

  ⛔ **`docs/api-coverage.md` called the 128-character comment unenforced.** It was generated from the
  vendor schema alone, hours after the tables started enforcing 321 rows of it, so the gap column
  counted every rule the guard had just closed — including the one the report opens by describing.
  `POST /config/verify` now reads `unenforced: []`, PBS's owned gap falls 144 → 62 and PVE's 545 →
  490, and a `format` is still never subtracted because the tables record the name and check nothing.

  ⛔ **The two manifests named two different PVE schemas.** `codegen/manifest.json` said 9.2.11 and
  `schemas/manifest.json` said 9.2.4 — both true of this genuinely mixed-version cluster, differing by
  two write endpoints, and nothing said so. Both now name the same bytes and the same versioned cache
  filename, and `tests/schema-manifest.test.ts` fails if they ever diverge again.

  New tests: `constraints-dialect.test.ts` holds a mutant for each newly enforced kind, and
  `constraints-live.test.ts` runs all ten objects of the live PBS inventory — the real ids, stores,
  schedules and retention values, comment text replaced by same-length filler because this package is
  public — through their create AND update tables expecting zero violations, which is the false
  positive this feature could itself cause. `constraints.test.ts` is split at the 250-line house cap.

## 0.15.0

### Minor Changes

- [#106](https://github.com/taslabs-net/homeflare-kit/pull/106) [`fc026e7`](https://github.com/taslabs-net/homeflare-kit/commit/fc026e7b81d937f614515abe8b2a2d7bb2a2d019) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Forward every `Bao.*` family's `Props` and `Attributes` types from `@homeflare/alchemy/openbao`.

  Each family already re-exported its own types from its module, but the barrel forwarded only the
  VALUES for seven of them — `BaoAuthMethod`, `BaoCloudflareRole`, `BaoMount`, `BaoPkiRole`,
  `BaoPolicy`, `BaoProxmoxRole` and `BaoSshRole` — plus `BaoAuthRoleAttributes`,
  `BaoPluginAttributes`, `BaoJwtRoleAttributes` and `BaoJwtCallbackMode`.
