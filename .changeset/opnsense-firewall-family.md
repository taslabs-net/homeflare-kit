---
'@homeflare/alchemy': minor
---

New `@homeflare/alchemy/opnsense` subpath, built on `@distilled.cloud/opnsense` (aliased onto
`@homeflare/distilled-opnsense@0.2.0`, generated against `opnsense/core`/`opnsense/plugins`
`26.7.2` — **inferred, never measured live**; SSH to the edge is forbidden by house policy).
`Opnsense.Firewall.Alias`, `.Category` and `.Group` (interface groups) are **READ-ONLY BY
DESIGN**: `reconcile` and `delete` always fail with a typed `OpnsenseWriteRefused`, naming the
policy ("read-only by Tim's rule, 2026-09-24; lifting it is a kit change") — neither handler
imports an `add`/`set`/`del`/`toggle` operation from the SDK, and `write-refusal.test.ts` proves
no write is reachable from any handler against a fake that fails on any non-GET request.

`read` follows upstream's `Snippet.ts` reference for a marker-less API exactly: a cold match is
`Unowned`, never a silent adopt, and each resource's convenience constructor
(`firewallAlias`/`firewallCategory`/`firewallGroup`) pipes `adopt(true)` on by default. All three
read through `get()` (the whole model tree, keyed by uuid) rather than a per-item endpoint —
`firewall_alias` has none, and `firewall_category`/`firewall_group`'s own `getCategory`/`getGroup`
carry no `uuid` in their generated request schema, a measured SDK generation gap this family works
around uniformly rather than relies on. Each resource also exports a pure declaration renderer
(`aliasPropsFromLive`/`categoryPropsFromLive`/`groupPropsFromLive`): given one live item, it
returns exactly the props a declaration needs to plan noop against it — what a later import
script will use to generate `alchemy.run.ts` rows from a live read.

This first import pass covers the three SDK modules that export both a `get` and a `search<Item>`
operation and are stable configuration (not runtime state): `firewall_alias`, `firewall_category`,
`firewall_group`. Skipped, and why, in `docs/opnsense.md`: `firewall_filter` (rules) and
`routing_settings` (gateways) have `get` but no `search*`; `quagga_general` is a settings
singleton with no uuid; `quagga_bgp` mixes several item types with no `search*` for any of them;
`quagga_service` is pure runtime control (start/stop/restart/status).

Credentials are `OPNSENSE_URL`/`OPNSENSE_API_KEY`/`OPNSENSE_API_SECRET`, read at call time through
the SDK's own `CredentialsFromEnv` (HTTP Basic, the vendor's own scheme), never a prop. No live
call of any kind was made building this family — every test runs against `fake-opnsense.ts`, a
loopback fake.
