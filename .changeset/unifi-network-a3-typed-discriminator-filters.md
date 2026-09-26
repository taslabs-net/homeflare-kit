---
'@homeflare/distilled-unifi-network': minor
---

Regenerated `src/` from the distilled clone's `homeflare/unifi-network` worktree against the pinned
10.4.57 spec (sha256 `3773947b4572b1bdc84272d3d2b9ebb5cad0d9aaa2640c3418568df97c9df59d`, unchanged from
the last regen). One behavioral change, read-only-safe (no write path exists in or through this
package): three field groups whose per-variant shape IS the field's whole value now decode a real TS
union instead of opaque `unknown`.

- **`FirewallPolicyIPProtocolScope.protocolFilter`** → `FirewallPolicyIPv4Protocol |
FirewallPolicyIPv4AndIPv6Protocol | FirewallPolicyIPv6Protocol`. The vendor's `discriminator.mapping`
  keys this by the SIBLING `ipVersion` field on the parent, not by anything on `protocolFilter` itself —
  all 3 cases share an identical key set, so this is a type-level distinction only.
- **`FirewallPolicySourceTrafficFilter.macAddressFilter`** → `string | FirewallPolicyMACAddressFilter`
  — a bare MAC string when matching additionally by MAC on a non-MAC filter, the full
  `{macAddresses}` object when the filter's own `type` is `"MAC_ADDRESS"`.
- **`ACLRule`/`ACLRuleObject`'s `source`/`destinationFilter`, and `CreateAclRuleRequest`/
  `UpdateAclRuleRequest`'s same fields** → `IPACLRuleEndpoint | MACACLRuleEndpoint`, keyed by the
  endpoint's own `type`. Along the way, fixed a latent bug in the distilled clone's flattening pass:
  `ACLRule`'s own filters were previously `unknown` with no widening warning at all — a trailing thin
  `allOf` entry (`ACL ruleObject`, structurally identical to `ACL rule`) was silently re-thinning the
  real `$ref`'d shape before the conflict-detection code ever ran, so only the create/update request
  bodies' filters showed up in the widened-field log. Fixed at the merge step (`mergeProperties`), not
  worked around here.
- **`CreateTrafficMatchingListRequest`/`TrafficMatchingList`/`UpdateTrafficMatchingListRequest`'s
  `items`** → `Array<IPv4Matching> | Array<IPv6Matching> | Array<PortMatching>`, keyed by each item's
  own `type`.

The runtime schema is a plain opaque `S.Unknown` (Argo CD's `union:` callback, shared by 69 distilled
packages) — narrower for a reader at the TYPE level only; decode stays exactly as permissive as the
`unknown` it replaces, so this carries none of the "drops an unrecognized key" risk a per-variant
`S.Struct` would. **Not** `unionStyle: "opaque-cases"` (Cloudflare/Discord/Slack/Supabase/Typesense's
style) — that was tried here first and reverted: its `T.UnionCases` annotation makes decode keep ONLY
the best-matching case's keys, silently dropping a key this spec doesn't yet declare and, on a
same-key-set tie, attributing a value's keys to the wrong case outright. A regression test proving the
pass-through (`packages/alchemy/src/unifi/discriminated-filter-decode.test.ts`, fabricated fixtures)
ships alongside this changeset. Bumped `minor`, not `patch`: code that previously had to cast
`.protocolFilter`/`.macAddressFilter`/`.sourceFilter`/`.destinationFilter`/`.items` off `unknown` now
sees a real union and may need to narrow it instead — though no kit provider reads any of these
families yet, so nothing here currently carries the change into declared state.

Scoped deliberately: `Network.ipv4Configuration`, `Client.access`, `WifiBroadcast.radiusConfiguration`,
and mDNS `name` are UNCHANGED, still opaque `unknown` — `Network` already ships as `Unifi.Network`, and
retyping its widened field would flip a permissive decode to a strict per-variant one for an
already-adopted family, a real behavior change that needs a live snapshot and its own decision, not a
mechanical extension of this fix.

Also: re-verified against a fresh `beezly/unifi-apis` `10.6.97.json` mirror fetch (mirror commit
`2457b337173c83599c583993210218b1b6c0f8e7`, diffing aid only — the regen source stays the pinned
10.4.57 file) that the 139-schema closure reachable from all 25 FirewallPolicy/ACL rule/
TrafficMatchingList operations — following `$ref` AND `discriminator.mapping`, not `$ref` alone — is
byte-identical between the two spec versions (`docs/spec-version-provenance.md` in the clone).
`docs/codegen-notes.md` and `docs/discriminator-flattening-rationale.md` updated to describe the new
allowlist and why the four remaining fields stay widened.

`networks.ts` is byte-unchanged (`diff -rq` against the prior release); `firewall.ts`'s `FirewallZone`
content carries no changes, only `FirewallPolicy`'s.
