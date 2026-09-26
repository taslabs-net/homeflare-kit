# UniFi DNS Policies — `Unifi.DnsPolicy`

⛔ **READ-ONLY, BY TIM'S RULE (2026-09-24).** Same posture as `docs/unifi.md`'s `Unifi.Network`/
`Unifi.FirewallZone`: `reconcile`/`delete` both fail with a typed `UnifiWriteRefused`, and the
`GetOnlyHttpClient` wire guard (`resource.ts`) refuses any non-`GET` request before it reaches the
transport. This family calls no SDK write op anywhere — `write-op-reference.test.ts` proves it
statically, and `dns-policy.test.ts`'s own write-path tests prove `reconcile`/`destroy` never send
anything but the one `GET` this spec's `fetchLive` makes.

## One flat DTO for every DNS record type

⚠️ **Corrected 2026-09-26 (red team, Important finding 1): the vendor spec DOES discriminate.**
The pinned spec's `DNS policy` schema carries a 7-way `discriminator.mapping` on `type`
(`A_RECORD`, `AAAA_RECORD`, `CNAME_RECORD`, `FORWARD_DOMAIN`, `MX_RECORD`, `SRV_RECORD`,
`TXT_RECORD`), each mapping to its own variant DTO (`IntegrationDnsARecordDto`, …) that carries the
record-specific fields (`ipv4Address`, `ttlSeconds`, `text`, …) — the base `DNS policy` schema
itself has only `domain`/`enabled`/`id`/`metadata`/`type`. None of those variant DTOs are reachable
from the base schema by a plain `$ref` walk; they exist only behind the `mapping` (T11 gate below).

What IS still true: `scripts/convert.ts` FLATTENS all 7 variants into one struct — every variant
field becomes optional on the same `DNSPolicy`/`CreateDnsPolicyRequest`/`UpdateDnsPolicyRequest`
type, rather than widening any of them to `unknown` (T10). No two variants collide on a field name,
so the flattening loses no information. **That means `dns-policy-form.ts` still has no opaque-JSON
field to flag or defer, unlike `acl-rule-form.ts`'s `sourceFilter`/`destinationFilter`
(`docs/unifi-acl-rule.md`)** — that conclusion holds; only the "never discriminates" reason given
for it originally was wrong.

⛔ **No array field exists anywhere in this shape**, so none of `network-form.ts`'s/
`firewall-zone-form.ts`'s/`acl-rule-form.ts`'s `sortedSet` set-normalizing applies here —
`drift.ts`'s default `stripNullish` tolerance for UniFi's `null`-for-unset-optional fields is the
whole story for `dns-policy-drift.ts`.

## `id`/`metadata` are attributes-only, same split as every other family here

`DnsPolicyProps` mirrors `UpdateDnsPolicyRequest`, not `DNSPolicy`: `id` and `metadata.origin` are
server-derived (no writable field accepts either), reported in `DnsPolicyAttributes` but never
compared or declared — the same split `network-form.ts` and `firewall-zone-form.ts` document for
their own server-derived fields.

## T11 gate: per-tag closure diff, 10.4.57 vs 10.6.97 (checked 2026-09-26, corrected same day)

Run together with `Unifi.AclRule`'s own gate, since both tags were diffed in the same pass —
**full breakdown, pin/mirror checksums and mirror commit are in
[`docs/unifi-acl-rule.md`](./unifi-acl-rule.md), not repeated here.** Summary for this family: all
5 `DNS Policies` operations are byte-identical between 10.4.57 and 10.6.97 (parameters, request
body, responses, unresolved `$ref`s included). ⚠️ The schema closure is **46 schemas, not 17** — a
plain `$ref` walk misses everything reachable only through `discriminator.mapping` (see "One flat
DTO" above), which for this tag is all 7 DNS record variant DTOs plus their 7 create/update
siblings. Re-run with `$ref` + `mapping` both followed, the full 46-schema closure (both tags
together) shares zero names with the 14 schemas that changed anywhere in the document between the
two versions — all 14 are `Switching`-, `Filtering`- or one `UniFi Devices` enum-shaped, none of it
DNS- or ACL-shaped. **Answer unchanged: `Unifi.DnsPolicy` would not decode differently against a
10.6.97 console** — the conclusion survives the correction; only the closure method and count were
wrong. **Method note for the next family (B4+): always follow `discriminator.mapping`, not just
`$ref` — a `$ref`-only walk silently under-counts any tag with a discriminated schema.**

## The declaration renderer

`declareDnsPolicy(live, siteId)` is a pure function, same contract as `declareNetwork`/
`declareFirewallZone` (`docs/unifi.md`): given one `getDnsPolicy` response, it returns the `Props`
a declaration needs so its plan is a no-op. A later import script reads every DNS policy on a site
and writes one `dnsPolicy('<id>', declareDnsPolicy(live, siteId))` row per result — nothing here
performs that write.

## Field-level drift

`dns-policy.ts` exports a pure `driftOf(live, props)` (`dns-policy-drift.ts`), built on `drift.ts`'s
`makeDriftOf` framework — the same one `Unifi.Network`/`Unifi.FirewallZone`/`Unifi.AclRule` use.
`matches` is exactly `fieldDrift(...).length === 0`, never a second hand-written comparison
(MEDIUM-4, `network-drift.ts`'s own header).

## Vendor version

UniFi Network Integration API **10.4.57**, same pin as `docs/unifi.md`, via
`@distilled.cloud/unifi-network` aliased onto `@homeflare/distilled-unifi-network@0.2.0`.
