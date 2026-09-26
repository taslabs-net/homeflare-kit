---
'@homeflare/alchemy': minor
---

Added three more read-only `Unifi.*` families, mirroring `Unifi.Network`/`Unifi.FirewallZone`'s existing shape: `Unifi.DnsPolicy`, `Unifi.AclRule`, and `Unifi.AclRuleOrdering` (one ordered, order-preserving resource per site — never `sortedSet` — for the site's ACL rule priority list, kept separate from `Unifi.AclRule` itself). Each is gated on a per-tag OpenAPI closure diff (10.4.57 vs a 10.6.97 mirror, diffing aid only) confirming its tag decodes the same on both versions; full breakdown in `docs/unifi-dns-policy.md` and `docs/unifi-acl-rule.md`. No write path exists for either family — `reconcile`/`delete` refuse via the existing typed `UnifiWriteRefused`, and the existing `GetOnlyHttpClient` wire guard and static write-op-reference test cover them without any change to either mechanism.
