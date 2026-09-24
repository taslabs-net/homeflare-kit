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
