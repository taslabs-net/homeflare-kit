# UniFi ACL Rules — `Unifi.AclRule` / `Unifi.AclRuleOrdering`

⛔ **READ-ONLY, BY TIM'S RULE (2026-09-24).** Same posture as `docs/unifi.md`'s `Unifi.Network`/
`Unifi.FirewallZone`: `reconcile`/`delete` both fail with a typed `UnifiWriteRefused`, and the
`GetOnlyHttpClient` wire guard (`resource.ts`) refuses any non-`GET` request before it reaches the
transport. Neither family here calls `createAclRule`, `updateAclRule`, `deleteAclRule` or
`updateAclRuleOrdering` anywhere — `write-op-reference.test.ts` proves it statically.

## Two resources, because rule order is not a rule's own property (T5)

`Unifi.AclRule` is one user-defined ACL rule (`getAclRule`/`getAclRulePage`).
`Unifi.AclRuleOrdering` is the site's ONE ordered list of rule IDs (`getAclRuleOrdering`,
`GET /v1/sites/{siteId}/acl-rules/ordering`) — not one-per-rule and not one-per-zone-pair the way a
future `Unifi.FirewallPolicyOrdering` will be (`network.ts`'s header names that as a separate,
bigger PR), because ACL rule ordering is site-wide, not keyed by a source/destination zone pair.

⛔ **`orderedAclRuleIds` IS NEVER RUN THROUGH `sortedSet`.** Every other multi-value field in this
directory that gets normalized (`firewall-zone-form.ts`'s `networkIds`, this family's own
`enforcingDeviceFilter.deviceIds`/`protocolFilter` below) is a SET with no documented order.
`orderedAclRuleIds` is the opposite: its position IS the value — `ACLRule.index`'s own field
comment says "Lower index has higher priority," and the whole point of `updateAclRuleOrdering` is
to change that priority by reordering the list. `acl-rule-ordering-form.ts`'s `matches`/`driftOf`
compare it with plain `deepEqual`, which — per `drift.ts`'s own header — sorts object keys but
never array elements, so leaving this one field un-normalized is what makes the resource actually
represent order.

## `Unifi.AclRule`'s own fields

- **`sourceFilter`/`destinationFilter` stay opaque `unknown`**, on the SDK's own authority
  (`access_control_acl_rules.ts`'s comment on both: "Shape varies by variant — widened by
  scripts/convert.ts"). This is the same converter-flattening trap (T10) `network-form.ts` already
  documents for `ipv4Configuration`; typing these per-discriminator (A3) is explicitly scoped OUT
  of this PR. Compared with plain `deepEqual` — honest about not being decoded, not a guess at a
  narrower shape.
- **`enforcingDeviceFilter.deviceIds` and `protocolFilter` are SETS**, normalized with the same
  `sortedSet` `firewall-zone-form.ts` uses for `networkIds`: neither field's own vendor description
  ("IDs of the Switch-capable devices used to enforce the ACL rule," "Protocols this ACL rule will
  be applied to") indicates order, and leaving either un-normalized would let a console-side
  reorder plan a spurious `update` this read-only family's `reconcile` then refuses forever.
- **`index` is attributes-only, never declared.** `CreateAclRuleRequest`'s own comment on the
  field: "This property is deprecated and has no effect. Use the dedicated ACL rule reordering
  endpoint." Reported so a reader can see a rule's current position, but never compared —
  `Unifi.AclRuleOrdering` above is where that position is actually declared.
- **`metadata.origin` is attributes-only**, same split `firewall-zone-form.ts`'s `metadataOrigin`
  uses — `UserDefinedOrDerivedEntityMetadata` is server-derived, no writable field accepts it.

## T11 gate: per-tag closure diff, 10.4.57 vs 10.6.97 (checked 2026-09-26)

Same method `spec-version-provenance.md` (distilled package) used for Networks/FirewallZones,
run here for `DNS Policies` (5 ops) and `Access Control (ACL Rules)` (7 ops) — 12 operations total,
covering both families in this PR plus `Unifi.DnsPolicy` (`docs/unifi-dns-policy.md`).

- **Pin**: `~/.cache/homeflare/schemas/unifi/network_v10.4.57_openapi.json`, re-verified against
  its own `SHA256SUMS` today (`3773947b…c9df59d`).
- **Mirror**: `raw.githubusercontent.com/beezly/unifi-apis/main/unifi-network/10.6.97.json`,
  diffing aid only, never a spec of record (Q5/M9) — `info.version: "10.6.97"`,
  `sha256: 44fd0e7f81603bb1279889a528a443d8f1a0102436e4a29675d8451adf32bd78`, mirror commit
  `f979dd64ec0ea6008c2a698c278fe49a10e102c8` (Andrew Beresford, 2026-08-20, "Add UniFi API specs:
  Network 10.6.97", GitHub-verified signature).
- **Operation count**: both versions carry exactly the same 12 operations for these two tags — zero
  added, zero removed, in either direction.
- **Full raw operation objects** (parameters, request body, responses, unresolved `$ref`s
  included — not just named schemas, the same reason `unifi.md`'s own check goes past a
  schema-name diff): byte-identical for all 12, both versions.
- **14 component schemas differ somewhere in the whole document** (of 379/380 total) — the SAME 14
  `unifi.md`'s own Networks/FirewallZones check found: 9 switch-stack/LAG schemas (`Switching`
  tag), 4 generic `filter`-query-syntax schemas (`FilterExpression` and its three siblings,
  matching the new `Filtering` tag), and one mDNS enum addition (`SHELLY`, `UniFi Devices` tag).
  Full per-schema breakdown: the distilled package's own `docs/spec-version-provenance.md`.
- **Reachability**: resolved every `$ref` reachable from the 12 operations' full parameter/body/
  response trees, recursively, in both versions. The closure is 17 schema names in both versions,
  identical set (`ACL rule`, `ACL rule device filter`, `ACL rule ordering`, `ACL rule update`,
  `ACL ruleObject`, `Create or update DNS policy`, `DNS policy`, `Entity metadata`,
  `IntegrationAclRulePageDto`, `IntegrationDnsPolicyPageDto`, `Site-to-site VPN tunnel metadata`,
  and five entity-metadata variants) — **zero overlap** with the 14 that changed.

**Answer: neither `DnsPolicy` nor `AclRule`/`AclRuleOrdering` would decode differently against
10.6.97.** This does not generalize past 10.6.97 or to any other tag — re-run this same check
before importing or declaring against `Clients`, `WiFi Broadcasts`, `Traffic Matching Lists`,
`Switching`, or `Firewall` (`FirewallPolicy`).

## The declaration renderers

`declareAclRule(live, siteId)` and `declareAclRuleOrdering(live, siteId)` are pure functions, same
contract as `declareNetwork`/`declareFirewallZone` (`docs/unifi.md`): given one live read, they
return the `Props` a declaration needs so its plan is a no-op. Neither performs the read itself.

## Field-level drift

`acl-rule.ts`/`acl-rule-ordering.ts` each export a pure `driftOf(live, props)`
(`acl-rule-drift.ts`, `acl-rule-ordering-form.ts`), built on the same `drift.ts`'s `makeDriftOf`
framework as `Unifi.Network`/`Unifi.FirewallZone` — `matches` is exactly
`fieldDrift(...).length === 0`, never a second hand-written comparison (MEDIUM-4).

## Vendor version

UniFi Network Integration API **10.4.57**, same pin as `docs/unifi.md`, via
`@distilled.cloud/unifi-network` aliased onto `@homeflare/distilled-unifi-network@0.2.0`.
