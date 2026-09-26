# UniFi Firewall Policies — `Unifi.FirewallPolicy` / `Unifi.FirewallPolicyOrdering`

⛔ **READ-ONLY, BY TIM'S RULE (2026-09-24).** Same posture as `docs/unifi.md`'s `Unifi.Network`/
`Unifi.FirewallZone`: `reconcile`/`delete` both fail with a typed `UnifiWriteRefused`, and the
`GetOnlyHttpClient` wire guard (`resource.ts`) refuses any non-`GET` request before it reaches the
transport. Neither family here calls `createFirewallPolicy`, `updateFirewallPolicy`,
`patchFirewallPolicy`, `deleteFirewallPolicy` or `updateFirewallPolicyOrdering` anywhere —
`write-op-reference.test.ts` proves it statically.

## Two resources, because policy order is not a policy's own property (T5)

`Unifi.FirewallPolicy` is one policy (`getFirewallPolicy`/`getFirewallPolicies`).
`Unifi.FirewallPolicyOrdering` is the ordered `before`/`afterSystemDefined` policy-id lists for ONE
`(sourceFirewallZoneId, destinationFirewallZoneId)` zone pair (`getFirewallPolicyOrdering`,
`GET /v1/sites/{siteId}/firewall/policies/ordering?sourceFirewallZoneId=…&destinationFirewallZoneId=…`)
— unlike `Unifi.AclRuleOrdering` (`docs/unifi-acl-rule.md`), which is site-wide, because firewall
policies are scoped to a zone pair and the vendor keys ordering the same way. There is no "list
every zone pair" endpoint; a caller has to already know which pairs exist, typically by walking
`getFirewallPolicies` (T9 — see below) and grouping by each policy's `source.zoneId`/
`destination.zoneId`. Neither resource performs that discovery.

⛔ **`beforeSystemDefined`/`afterSystemDefined` ARE NEVER RUN THROUGH `sortedSet`.** Both are
sequences — within each half, position is priority — the same "order IS the value" reasoning
`docs/unifi-acl-rule.md` gives for `orderedAclRuleIds`. `firewall-policy-ordering-form.ts` compares
each half independently with plain `deepEqual`, so a policy moving from one half to the other
reports as drift on BOTH fields rather than one combined reorder.

## `Unifi.FirewallPolicy`'s own fields

- **`action`/`destination`/`ipProtocolScope`/`schedule`/`source` are compound, compared wholesale.**
  Post-A3 (`8ee11f1`), these decode as real per-discriminator TS unions instead of `unknown`
  (`discriminated-filter-decode.test.ts` proves the wire path keeps every key, including one this
  pinned spec doesn't yet declare) — but this PR does not go on to build a leaf-by-leaf declarable
  schema for all 12 filter variants underneath them. Each is compared as ONE value with plain
  `deepEqual` (`stripNullish`), the same proportion `acl-rule-form.ts`'s `enforcingDeviceFilter`
  gets (one level of structure, not exploded into scalars).
  ⚠️ **Known gap (T15, same shape as `acl-rule-form.ts`'s own)**: several of the vendor's filter
  variants nested inside these fields are themselves set-like arrays with no documented order
  (`FirewallPolicyMACAddressFilter.macAddresses`, `FirewallPolicyNetworkFilter.networkIds`,
  `FirewallPolicyApplicationFilter.applicationIds`, `FirewallPolicyIPAddressFilter.items`,
  `FirewallPolicyRegionFilter.regions`, `FirewallPolicyVPNServerFilter.vpnServerIds`,
  `FirewallSchedule.repeatOnDays`) — `deepEqual` compares them order-sensitively, so a console-side
  reorder with no membership change would report a spurious drift this read-only family's
  `reconcile` then refuses forever. Accepted, not fixed: normalizing 12 filter variants' own nested
  arrays is bigger, separate modelling work, not a mechanical extension of A3.
- **`connectionStateFilter` is the one top-level Props array, and is a SET** — "matches all
  connection states" if null describes membership, not a sequence (unlike the ordering resource's
  own lists, where position IS the value). Normalized with the same `sortedSet` every other family
  here uses for a set-shaped array.
- **`index` is attributes-only, never declared.** `CreateFirewallPolicyRequest` has no `index`
  field — the live object's position among ALL policies on the site is reported, but its priority
  relative to its own zone pair is `Unifi.FirewallPolicyOrdering`'s concern, same split
  `acl-rule-form.ts`'s own `index` documents.
- **`metadata.origin` is attributes-only**, same split every family here uses.

## T11 gate: per-tag closure diff, 10.4.57 vs 10.6.97 (checked 2026-09-26)

Same method `docs/unifi-acl-rule.md` used, run here for the `Firewall` tag's 13 operations (5
already covered for `Unifi.FirewallZone` in `docs/unifi.md`; 8 new here: `getFirewallPolicies`,
`createFirewallPolicy`, `getFirewallPolicyOrdering`, `updateFirewallPolicyOrdering`,
`deleteFirewallPolicy`, `getFirewallPolicy`, `patchFirewallPolicy`, `updateFirewallPolicy`).

- **Pin**: `~/.cache/homeflare/schemas/unifi/network_v10.4.57_openapi.json`, re-verified against
  its own `SHA256SUMS` today (`3773947b…c9df59d`).
- **Mirror**: `raw.githubusercontent.com/beezly/unifi-apis/main/unifi-network/10.6.97.json`,
  diffing aid only, never a spec of record — re-fetched today, still `info.version: "10.6.97"`,
  `sha256: 44fd0e7f81603bb1279889a528a443d8f1a0102436e4a29675d8451adf32bd78`, unchanged since mirror
  commit `f979dd64ec0ea6008c2a698c278fe49a10e102c8` (Andrew Beresford, 2026-08-20, "Add UniFi API
  specs: Network 10.6.97", GitHub-verified signature) — the same file `docs/unifi-acl-rule.md` cites.
- **Operation count**: both versions carry exactly the same 13 operations for `Firewall` — zero
  added, zero removed, either direction.
- **Full raw operation objects** (parameters, request body, responses, unresolved `$ref`s included):
  byte-identical for all 13, both versions.
- **Reachability** (`$ref` AND `discriminator.mapping`, per `docs/unifi-acl-rule.md`'s corrected
  method): the closure is **106 schema names**, identical set in both versions. Every one of the 12
  filter variants' own sub-schemas (`IntegrationFirewallPolicySourceMacAddressFilterDto`, all three
  IP-protocol-scope Dto families, both action Dtos, etc.) is in it. **Zero overlap** with the 14
  schemas that changed elsewhere in the document (the same 9 `Switching`, 4 `Filtering`, 1 mDNS
  schemas `docs/unifi.md`/`docs/unifi-acl-rule.md` already found) — re-diffed all 106 with an
  order-independent structural compare: **zero differ**.
- **Corroboration**: the A3 changeset's own broader re-check
  (`.changeset/unifi-network-a3-typed-discriminator-filters.md`) independently walked all 25
  FirewallPolicy/ACL rule/TrafficMatchingList operations together — a 139-schema closure, also
  byte-identical between versions — against a mirror fetch the same day citing commit
  `2457b337173c83599c583993210218b1b6c0f8e7` (that commit only touches `README.md`; the spec file
  itself has been untouched, hence unchanged, since `f979dd64` above).

**Answer: neither `FirewallPolicy` nor `FirewallPolicyOrdering` would decode differently against
10.6.97.** This does not generalize past 10.6.97 or to any other tag — re-run this check, following
BOTH `$ref` and `discriminator.mapping`, before importing or declaring against `Clients`,
`Switching`, or any tag not yet covered by an existing `docs/unifi-*.md`.

## The declaration renderers

`declareFirewallPolicy(live, siteId)` and `declareFirewallPolicyOrdering(live, siteId, sourceZoneId,
destZoneId)` are pure functions, same contract as every other family's own (`docs/unifi.md`): given
one live read, they return the `Props` a declaration needs so its plan is a no-op.

## Field-level drift

`firewall-policy.ts`/`firewall-policy-ordering.ts` each export a pure `driftOf(live, props)`
(`firewall-policy-drift.ts`, `firewall-policy-ordering-form.ts`), built on the same `drift.ts`'s
`makeDriftOf` framework as every other family — `matches` is exactly `fieldDrift(...).length === 0`,
never a second hand-written comparison (MEDIUM-4).

## Vendor version

UniFi Network Integration API **10.4.57**, same pin as `docs/unifi.md`, via
`@distilled.cloud/unifi-network` aliased onto `@homeflare/distilled-unifi-network@0.3.0`.
