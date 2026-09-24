# UniFi Network — `@homeflare/alchemy/unifi`

⛔ **READ-ONLY, BY TIM'S RULE (2026-09-24).** `Unifi.Network` and `Unifi.FirewallZone` read and
adopt; neither has a create, an update body or a working delete. `reconcile`/`delete` both fail
with a typed `UnifiWriteRefused` naming the policy rather than calling any SDK write operation.
Lifting the rule is a kit change — a PR that adds a write path, reviewed as one — not a flag a
stack can pass. See `packages/alchemy/src/unifi/policy.ts`.

## What's declared, and why these two first

`Unifi.Network` (`getNetworkDetails`/`getNetworksOverviewPage`) and `Unifi.FirewallZone`
(`getFirewallZone`/`getFirewallZones`) — both list+get pairs over genuine, stable configuration,
not runtime state (a connected client, a device statistic, a hotspot voucher, a switch stack).
`Site` was the SDK README's other first suggestion; it has no `getSite`, only the list operation,
so it fails this house's own "both a list and a get" bar for a first import. `FirewallPolicy` is
also a list+get config object, but its `source`/`destination`/`ipProtocolScope` fields carry
several of the vendor's converter-flattened discriminator variants each, and its ordering
endpoint replaces the whole rule list — modelling that correctly is a bigger, separate PR.

## Credentials

Two environment variables, read **at call time**, never props — the SDK's own
`CredentialsFromEnv` (`@distilled.cloud/unifi-network/Credentials`):

| variable                     | holds                                               |
| ---------------------------- | --------------------------------------------------- |
| `UNIFI_NETWORK_API_KEY`      | an Integrations → API Key from the console's own UI |
| `UNIFI_NETWORK_API_BASE_URL` | the console's integration API root — see below      |

⛔ **Neither has a default**, and neither is ever logged, committed or persisted in state.

⛔ **No console identifier, endpoint host or other live value ever appears in code, tests,
fixtures, commits or a PR.** The base URL shape depends on how the console is reached: a cloud
connector's is `https://api.ui.com/v1/connector/consoles/<consoleId>/proxy/network/integration`
(`<consoleId>` is an account identifier); a local console is reached directly,
`<endpoint>/proxy/network/integration`, where `<endpoint>` is a hostname behind a TLS certificate
the caller trusts. Treat any UniFi base URL as sensitive; this package's tests use only the RFC
2606 placeholder `https://unifi.example.com`.

The estate's own credential lives in OpenBao at `kv/infra/unifi/api` — fields `api_key`,
`connector_id`, `console`, `endpoint`, `site`, `transport` (`transport=local`: this console is
reached directly, not through the cloud connector). A separate `kv/infra/unifi/site-manager`
token is the _cloud_ Site Manager API credential, a different door (below) this family never
reads.

✅ **Auth was measured live, read-only, on 2026-09-24.** The OpenAPI document declares no
`securitySchemes` at all — `X-API-KEY` comes from Ubiquiti's own Integration API guide, not the
machine-readable spec (`@distilled.cloud/unifi-network/src/credentials.ts`'s own header) — but a
hand-run, read-only probe confirmed it works against the estate's local console: `X-API-KEY`
returns HTTP 200 on both `GET /v1/info` (key: `applicationVersion`) and `GET /v1/sites` (keys:
`count`, `data`, `limit`, `offset`, `totalCount`). The _same_ key against the `api.ui.com` cloud
connector returns 401 — the wrong door for a key minted on a local console, not evidence the
cloud shape rejects `X-API-KEY` outright; `kv/infra/unifi/site-manager` is the separate cloud
credential, untouched by this family. Only reads were probed, by hand, outside this package's own
test suite — nothing in this PR's code exercises the vendor API live, and a write path would still
need its own verification.

## Adopt is the default posture, and it never writes

`adopt(true)` is piped onto every resource by its convenience constructor (`network(...)`,
`firewallZone(...)`) — H5. A cold read of a live match answers `Unowned(attrs)` (H1, the
`Cloudflare/Snippets/Snippet.ts` reference every marker-less family here follows: UniFi Network
objects carry no tag or metadata field this stack could stamp), and `adopt(true)` turns that into
a silent bind instead of an `OwnedBySomeoneElse` refusal — the deploy never needs `--adopt`.

⚠️ **A forced post-adoption reconcile still runs once (H6), and it still makes no write.**
Beta.79 forces one `reconcile` call after every cold adoption whether or not `diff` said noop.
`resource.ts`'s `reconcile` handles this the same way `discord/resource.ts` does: it reads the
live object again and only refuses when it is missing (would need a create) or drifted (would
need a write); an exact match returns the live attributes and calls nothing.

## `list` answers `[]`

`GET /v1/sites/{siteId}/networks` answers every network on the site. Adoption stays explicit —
the same reasoning `Proxmox.User`'s and NetBox's own `list` give.

## The declaration renderer

`declareNetwork(live, siteId)` and `declareFirewallZone(live, siteId)` are pure functions: given
one `getNetworkDetails`/`getFirewallZone` response, they return the `Props` a declaration needs
so its plan is a no-op. A later import script reads every object on a site and writes one
`network('<id>', declareNetwork(live, siteId))` row per result into `alchemy.run.ts` — nothing
here performs that write; these two functions are what the script would call.

## Vendor version

UniFi Network Integration API **10.4.57** (OpenAPI 3.1.0, 44 paths), via
`@distilled.cloud/unifi-network` aliased onto `@homeflare/distilled-unifi-network@0.2.0`
(`docs/distilled-interim.md`). Traps in the underlying API that this read-only family cannot
trigger but a future write path must respect — whole-object `PUT`, ordering endpoints that
replace the whole list, `removeDevice` unadopting and factory-resetting hardware — are recorded
in the distilled package's own `README.md` and in the estate's `docs/unifi-api-notes.md`
(outside this repo).

## Spec-version check against the live-measured console (2026-09-24)

`homeflare-network`'s `src/unifi/imported.ts` was generated 2026-09-24 against a live console
self-reporting **10.6.97** (`GET /v1/info`, recorded in that file's own header) — two minor
versions past this SDK's 10.4.57 pin. Checked whether any of the 11 imported networks or 14
imported firewall zones could decode differently on a newer controller than this SDK's
10.4.57-pinned types expect: diffed a 10.6.97 copy of Ubiquiti's OpenAPI document (a third-party
mirror, used only as a diffing aid — never as this SDK's spec of record; see the distilled
package's own `docs/spec-version-provenance.md`) against the pinned 10.4.57 document. Zero
operations added or removed anywhere in the API; every full raw operation object (parameters,
request body, responses, `$ref`s included) for every `Networks`-tagged operation and every
`*FirewallZone*` operation is identical, byte for byte, not just its named schemas (11 operations
on each side, same set — a named-schema diff alone would miss an inline, untagged parameter
changing shape, so this checks the operations directly).

**14 of the document's 379/380 component schemas do differ somewhere** — the switch-stack/LAG
family (`Switching` tag, matching Ubiquiti's own 10.6 release notes on LAG support), the generic
`filter`-query-syntax family (`FilterExpression`/`CompoundFilterExpression`/`NotFilterExpression`/
`PropertyFilterExpression`), and one mDNS enum addition (`SHELLY`, `UniFi Devices` tag) — but
**none of the 14 is reachable from a Networks or FirewallZone operation, even transitively**:
resolved every `$ref` reachable from each of the 11 operations' full parameter/body/response
trees, recursively, in both versions, and none of the 14 changed schema names appears in either
closure. Full breakdown of the 14 (which changed vs. added/removed, and why the reachability check
had to go beyond the direct operation-object diff above) is in the distilled package's own
`docs/spec-version-provenance.md`, not this repo.

**Answer: none of the imported rows would change shape against 10.6.97.** This does not
generalize past 10.6.97, and it says nothing about any tag besides Networks/FirewallZones —
re-check before importing or declaring against `Clients`, `WiFi Broadcasts`, `ACL Rules`, or any
other tag.

## 2026-09-24 doctrine walkdown

Read directly against `origin/main`'s `src/unifi/{resource,network,network-form,firewall-zone,
firewall-zone-form,policy}.ts`: `fetchLive` in `network.ts`/`firewall-zone.ts` folds only
`catchTag('NotFound', …)`, never a blanket catch. `destroy` always refuses via the typed
`UnifiWriteRefused` regardless of live state — correct here, not a departure from delete's usual
idempotency rule: this family will never issue a real DELETE by policy, so idempotency of a
delete it cannot perform is moot. No `Effect.orDie`/`Effect.die` anywhere in the family.
`sortedSet` normalizes every measured unordered array (`dhcpGuarding.trustedDhcpServerIpAddresses`,
`ipv6Configuration`'s two override lists, `firewall-zone-form.ts`'s `networkIds`) before it is
attributed, declared or compared. Both declaration renderers and both `matches` use
`value == null` / `deepEqual(..., { stripNullish: true })` consistently, per `network-form.ts`'s
own header. No departure found — nothing in this family needed changing.
