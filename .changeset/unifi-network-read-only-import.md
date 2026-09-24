---
'@homeflare/alchemy': minor
---

New `@homeflare/alchemy/unifi` subpath: `Unifi.Network` and `Unifi.FirewallZone`,
generated from Ubiquiti's own UniFi Network Integration API **10.4.57** (OpenAPI 3.1.0)
via `@distilled.cloud/unifi-network` (aliased onto `@homeflare/distilled-unifi-network@0.2.0`,
`docs/distilled-interim.md`).

⛔ **READ-ONLY, by Tim's rule (2026-09-24).** Neither resource has a create, an update body
or a working delete — `reconcile` and `delete` both fail with a typed `UnifiWriteRefused`
naming the policy, and no handler ever calls an SDK write operation (proved by fakes in
`resource.test.ts`, `network.test.ts` and `firewall-zone.test.ts` that record every request
sent and assert none is anything but `GET`). `read` answers `Unowned` on every match — never
a silent adopt — with `adopt(true)` piped on by default via the `network`/`firewallZone`
convenience constructors, so a first deploy against an existing object binds without a stack
needing `--adopt`. `list` answers `[]`; adoption stays explicit.

`declareNetwork(live, siteId)` and `declareFirewallZone(live, siteId)` are the declaration
renderers this PR ships alongside the resources: pure functions from one live read
(`getNetworkDetails`/`getFirewallZone`'s own response shape) to the `Props` a declaration
needs so its plan is a no-op — what a later import script will call to generate
`alchemy.run.ts` rows from a live site.

`Unifi.Network`/`Unifi.FirewallZone` were chosen as the first import set because both have a
list+get pair over genuine, stable configuration (not runtime state like a connected client,
a device statistic or a hotspot voucher) and a simple, non-discriminated wire shape. `Site`
(list-only, no `getSite`) and `Unifi.FirewallPolicy` (several converter-flattened
discriminator variants, and an ordering endpoint that replaces the whole rule list) are
deliberately out of scope for this PR — see `docs/unifi.md`.

`Unifi.Network`'s `matches` now normalizes the three fields the vendor document never says are
ordered — `dhcpGuarding.trustedDhcpServerIpAddresses`, `ipv6Configuration.additionalHostIpSubnets`,
`ipv6Configuration.dnsServerIpAddressesOverride` — before comparing, the same `sortedSet`
(dedupe + sort) fix `Unifi.FirewallZone` already applied to `networkIds`: alchemy's `deepEqual`
sorts object keys but not array elements, so an unchanged network whose console answered the same
set in a different order would otherwise plan a spurious `update` that the read-only reconcile
then refuses.

Auth was measured live, read-only, on 2026-09-24: `X-API-KEY` against the estate's local console
returns HTTP 200 on `GET /v1/info` and `GET /v1/sites`; the same key against the `api.ui.com`
cloud connector returns 401 (the wrong door, not a broken header) — see `docs/unifi.md`'s
"Credentials" section. This PR's own code still never calls the vendor API live.
