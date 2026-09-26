# UniFi Traffic Matching Lists — `Unifi.TrafficMatchingList`

⛔ **READ-ONLY, BY TIM'S RULE (2026-09-24).** Same posture as `docs/unifi.md`'s `Unifi.Network`/
`Unifi.FirewallZone`: `reconcile`/`delete` both fail with a typed `UnifiWriteRefused`, and the
`GetOnlyHttpClient` wire guard (`resource.ts`) refuses any non-`GET` request before it reaches the
transport. This family never calls `createTrafficMatchingList`, `updateTrafficMatchingList` or
`deleteTrafficMatchingList` anywhere — `write-op-reference.test.ts` proves it statically.

## The simplest object shape in this directory

`TrafficMatchingList` is `{id, name, type, items?}` — no `metadata` field at all, unlike every
other family here (`FirewallZone`/`DNSPolicy`/`ACLRule`/`FirewallPolicy` all carry a server-derived
`metadata.origin`). Nothing in `TrafficMatchingListAttributes` is attributes-only the way
`metadataOrigin`/`index` are elsewhere: every field this family reads is also declarable.

## `items` is a real TS union post-A3, compared wholesale

`items` decodes as `Array<IPv4Matching> | Array<IPv6Matching> | Array<PortMatching>`, keyed by the
sibling `type` field (A3, `8ee11f1`) — previously opaque `unknown`. The runtime schema is still a
passthrough `S.Unknown` (Argo CD's `union:` callback): narrower for a reader at the TYPE level only,
so decode keeps every key including one this pinned spec doesn't yet declare, the same proof
`discriminated-filter-decode.test.ts` runs for `FirewallPolicy`/`AclRule`.

⚠️ **Known gap (T15, same shape `acl-rule-form.ts`/`docs/unifi-firewall-policy.md` both carry)**: a
traffic matching list's `items` is semantically a SET of match entries — matching is "is this
traffic covered by ANY entry," not order-dependent — but each entry is an OBJECT
(`{type, value?, start?, stop?}`), not a bare string, so there is no cheap canonical sort key the
way `sortedSet` gives a `string[]`. `deepEqual` compares `items` order-sensitively, so a
console-side reorder with no membership change would report a spurious drift this read-only
family's `reconcile` then refuses forever. Accepted, not fixed: a generic object-set normalizer is
bigger, separate modelling work, not a mechanical extension of typing `items` per-discriminator.

## T11 gate: per-tag closure diff, 10.4.57 vs 10.6.97 (checked 2026-09-26)

Same method `docs/unifi-acl-rule.md`/`docs/unifi-firewall-policy.md` use, run here for the
`Traffic Matching Lists` tag's 5 operations (`getTrafficMatchingLists`, `createTrafficMatchingList`,
`deleteTrafficMatchingList`, `getTrafficMatchingList`, `updateTrafficMatchingList`).

- **Pin**: `~/.cache/homeflare/schemas/unifi/network_v10.4.57_openapi.json`, re-verified against
  its own `SHA256SUMS` today (`3773947b…c9df59d`).
- **Mirror**: `raw.githubusercontent.com/beezly/unifi-apis/main/unifi-network/10.6.97.json`,
  diffing aid only, never a spec of record — re-fetched today, still `info.version: "10.6.97"`,
  `sha256: 44fd0e7f81603bb1279889a528a443d8f1a0102436e4a29675d8451adf32bd78`, unchanged since mirror
  commit `f979dd64ec0ea6008c2a698c278fe49a10e102c8` (Andrew Beresford, 2026-08-20, "Add UniFi API
  specs: Network 10.6.97", GitHub-verified signature) — the same file every other family doc cites.
- **Operation count**: both versions carry exactly the same 5 operations for `Traffic Matching
Lists` — zero added, zero removed, either direction.
- **Full raw operation objects** (parameters, request body, responses, unresolved `$ref`s included):
  byte-identical for all 5, both versions.
- **Reachability** (`$ref` AND `discriminator.mapping`): the closure is **19 schema names**
  (`IPv4Matching`/`IPv6Matching`/`Port matching` and each of the three list-shape Dto pairs, plus
  their subnet/range/address variant Dtos), identical set in both versions. **Zero overlap** with
  the 14 schemas that changed elsewhere in the document — re-diffed all 19 with an
  order-independent structural compare: **zero differ**.
- **Corroboration**: the A3 changeset's own broader re-check
  (`.changeset/unifi-network-a3-typed-discriminator-filters.md`) independently walked all 25
  FirewallPolicy/ACL rule/TrafficMatchingList operations together — a 139-schema closure, also
  byte-identical between versions — against a mirror fetch the same day; see
  `docs/unifi-firewall-policy.md`'s own T11 section for why that citation's different-looking
  mirror commit is the same unchanged file.

**Answer: `TrafficMatchingList` would not decode differently against 10.6.97.** This does not
generalize past 10.6.97 or to any other tag — re-run this check, following BOTH `$ref` and
`discriminator.mapping`, before importing or declaring against `Clients`, `Switching`, or any tag
not yet covered by an existing `docs/unifi-*.md`.

## The declaration renderer

`declareTrafficMatchingList(live, siteId)` is a pure function, same contract as every other
family's own (`docs/unifi.md`): given one `getTrafficMatchingList` response, it returns the `Props`
a declaration needs so its plan is a no-op.

## Field-level drift

`traffic-matching-list.ts` exports a pure `driftOf(live, props)` (`traffic-matching-list-drift.ts`),
built on the same `drift.ts`'s `makeDriftOf` framework as every other family — `matches` is exactly
`fieldDrift(...).length === 0`, never a second hand-written comparison (MEDIUM-4).

## Vendor version

UniFi Network Integration API **10.4.57**, same pin as `docs/unifi.md`, via
`@distilled.cloud/unifi-network` aliased onto `@homeflare/distilled-unifi-network@0.3.0`.
