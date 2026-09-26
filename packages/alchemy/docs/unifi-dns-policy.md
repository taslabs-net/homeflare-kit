# UniFi DNS Policies — `Unifi.DnsPolicy`

⛔ **READ-ONLY, BY TIM'S RULE (2026-09-24).** Same posture as `docs/unifi.md`'s `Unifi.Network`/
`Unifi.FirewallZone`: `reconcile`/`delete` both fail with a typed `UnifiWriteRefused`, and the
`GetOnlyHttpClient` wire guard (`resource.ts`) refuses any non-`GET` request before it reaches the
transport. This family calls no SDK write op anywhere — `write-op-reference.test.ts` proves it
statically, and `dns-policy.test.ts`'s own write-path tests prove `reconcile`/`destroy` never send
anything but the one `GET` this spec's `fetchLive` makes.

## One flat DTO for every DNS record type

`dns_policies.ts`'s `DNSPolicy` covers every record `type` (`A`, `AAAA`, `CNAME`, `MX`, `SRV`,
`TXT`, `Forwarding`, …) with one flat set of optional fields — the vendor spec never discriminates
per `type` the way `access_control_acl_rules.ts`'s `sourceFilter`/`destinationFilter` or
`firewall.ts`'s policy filters do. That means **none of this family's fields were widened to
`unknown` by the converter (T10)** — every optional field decodes as a plain scalar
(`string`/`number`/`boolean`), so `dns-policy-form.ts` has no opaque-JSON field to flag or defer,
unlike `acl-rule-form.ts` (`docs/unifi-acl-rule.md`).

⛔ **No array field exists anywhere in this shape**, so none of `network-form.ts`'s/
`firewall-zone-form.ts`'s/`acl-rule-form.ts`'s `sortedSet` set-normalizing applies here —
`drift.ts`'s default `stripNullish` tolerance for UniFi's `null`-for-unset-optional fields is the
whole story for `dns-policy-drift.ts`.

## `id`/`metadata` are attributes-only, same split as every other family here

`DnsPolicyProps` mirrors `UpdateDnsPolicyRequest`, not `DNSPolicy`: `id` and `metadata.origin` are
server-derived (no writable field accepts either), reported in `DnsPolicyAttributes` but never
compared or declared — the same split `network-form.ts` and `firewall-zone-form.ts` document for
their own server-derived fields.

## T11 gate: per-tag closure diff, 10.4.57 vs 10.6.97 (checked 2026-09-26)

Run together with `Unifi.AclRule`'s own gate, since both tags were diffed in the same pass —
**full breakdown, pin/mirror checksums and mirror commit are in
[`docs/unifi-acl-rule.md`](./unifi-acl-rule.md), not repeated here.** Summary for this family: all
5 `DNS Policies` operations are byte-identical between 10.4.57 and 10.6.97 (parameters, request
body, responses, unresolved `$ref`s included), and the schema closure reachable from them (`DNS
policy`, `Create or update DNS policy`, `IntegrationDnsPolicyPageDto`, `Entity metadata` and its
variants) shares zero names with the 14 schemas that changed anywhere in the document between the
two versions — all 14 are `Switching`-, `Filtering`- or one `UniFi Devices` enum-shaped, none of it
DNS-shaped. **Answer: `Unifi.DnsPolicy` would not decode differently against a 10.6.97 console.**

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
