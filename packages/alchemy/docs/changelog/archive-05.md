# Alchemy changelog archive 5

[Current changelog](../../CHANGELOG.md) · [Archive index](./README.md)

`zfs-pool-adopt.test.ts` (the existing coverage — adopt-only noop/adopted, retain-vs-destroy, the
`ZfsRaidLevel` compile-time refusal) passes unchanged against the migrated code — `fake-pve.ts`'s
stub is transport-agnostic — plus one new case for finding 2 above (confirmed to reach a live
`POST` on the fake cluster without the fix, before timing out at the settle-poll). `zfs-pool-read-
failure.test.ts` (new) pins the cries-wolf fix, the transient-failure propagation, and the
`alchemy drift` fix, mirroring PR 243's `storage-read-failure.test.ts` — each assertion confirmed
to fail against the pre-fix code before landing.

**Scope note, not fixed by this PR:** `Proxmox.NodeNetwork` and `Proxmox.NetworkApply` (the rest
of the "ZFS pools + node network" sub-area) are deferred to a follow-up PR — see that PR's own
description for why they don't travel with this one.

**Expected after this releases and the consumer bumps:** no live plan change is expected — no
`Proxmox.ZfsPool` row was among the false-update rows PR 239/243 already fixed (this family's
`read`-role lease could always read it), so this PR is a transport migration plus a defensive fix
for a bug class not yet measured live for this specific family.

## 0.32.0

### Minor Changes

- [#236](https://github.com/taslabs-net/homeflare-kit/pull/236) [`3b4a5eb`](https://github.com/taslabs-net/homeflare-kit/commit/3b4a5eb37b1d136d1f899c48bccf50824c13f9bc) Thanks [@taslabs-net](https://github.com/taslabs-net)! - New `@homeflare/alchemy/opnsense` subpath, built on `@distilled.cloud/opnsense` (aliased onto
  `@homeflare/distilled-opnsense@0.2.0`, generated against `opnsense/core`/`opnsense/plugins`
  `26.7.2` — **measured live 2026-09-24** over the HTTPS API only, no SSH: the edge reports
  `26.7.2_2`, one patch ahead of the generation tag, same series; see `docs/opnsense.md`).
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
  the SDK's own `CredentialsFromEnv` (HTTP Basic, the vendor's own scheme), never a prop — today the
  only key that exists is ROOT-level, one more reason writes stay refused unconditionally. This
  family's own test suite makes no live call — every test runs against `fake-opnsense.ts`, a
  loopback fake; the SDK's `26.7.2` version pin was measured separately, live and read-only
  (`docs/opnsense.md`).

- [#238](https://github.com/taslabs-net/homeflare-kit/pull/238) [`d28861f`](https://github.com/taslabs-net/homeflare-kit/commit/d28861f00dce0d9dd17e5857e95332f8d009fa2c) Thanks [@taslabs-net](https://github.com/taslabs-net)! - New `Podman.Container` resource in `@homeflare/alchemy/linux` — one Podman Quadlet `.container`
  file, declared, plus the systemd unit Podman's own generator turns it into. Built for Tim's
  2026-09-24 decision that CT100's containers (the two Grafanas, shared Postgres, shared Valkey,
  later TeslaMate and NetBox) are owned by Alchemy through Quadlet rather than upstream Alchemy's
  `Docker.Container`, which was measured and rejected: no host-network prop (every container here
  runs `--network host`), `environment` puts `Redacted` secrets in Alchemy state, and systemd
  already supervises the containers.

  Reuses the `Systemd.Unit` family's lifecycle machinery directly (`renderUnit`, `isUnitRunning`,
  `UNIT_WRITE`, `daemonReload`/`showUnit`/`startUnit`/`stopUnit`/`restartUnit` from `systemctl.ts`,
  which also gains `SourcePath` to `SHOW_PROPERTIES` — additive for `Systemd.Unit`). `[Container]`
  is typed and checked against `podman-systemd.unit(5)`, Podman 5.4 (CT100 runs 5.4.2): `Image`,
  `ContainerName`, `Network` (supports `'host'`), `Volume`, `EnvironmentFile`, `Environment`
  (never a secret — refused by name and value shape if it looks like one, `container-secrets.ts`),
  `PublishPort`, `Exec`, `User`, `AutoUpdate`, `PodmanArgs`; `[Unit]`/`[Service]`/`[Install]` mirror
  `Systemd.Unit`'s verbatim-lines approach with typed conveniences for `Description`/`Documentation`,
  `Restart`/`RestartSec` and `WantedBy`/`RequiredBy`/`Alias` (the only three `[Install]` keys
  Quadlet honours for a `.container` file, doc-confirmed).

  The lifecycle differs from `Systemd.Unit` in the one place the generator forces it to: there is
  no `enabled` prop and the resource never calls `systemctl enable`/`disable` — MEASURED on CT100
  (`caddy.container`) that a generated unit is transient and doc-confirmed
  (`podman-systemd.unit(5)`) that `systemctl enable` does not work on one; Quadlet applies
  `[Install]` itself at every `daemon-reload`. A generator failure (a `.container` file Quadlet
  refuses) surfaces as a typed `QuadletGeneratorError`, never "absent" — reasoned from
  `systemd.generator(7)` (`daemon-reload` deletes and regenerates ALL generator output): an UPDATE
  that fails verification restores the LAST-KNOWN-GOOD file and reloads again, so a container this
  resource already promised running never loses its systemd unit to a bad update, rather than
  leaving the new file for the next deploy to retry the way `Systemd.Unit` does.

  `container-fixture.test.ts` renders the same directives as CT100's live `caddy.container`
  (read read-only over `ssh ct100`), and documents why byte-for-byte is not the right bar for a
  typed `[Container]` section (CT100's file interleaves prose comments between directives, which a
  typed prop has nowhere to attach). Full guide: `docs/quadlet-container.md`.

  Two rounds of review before opening/landing this PR — one foreground Sonnet adversarial pass
  before opening it, aimed at restart-safety and secret leakage, and one inline coordinator
  review after. All three findings were real and are fixed:

  - **Restart-safety, interrupted UPDATE (high).** `reconcileContainer`'s reload gate (`wrote ||
preStatus.needDaemonReload`) could not see that the SOURCE `.container` file had already been
    written by an apply that crashed before its `daemon-reload` ran: on retry, the file already held
    the new content (`wrote: false`) and the still-stale GENERATED unit hadn't changed either
    (`needDaemonReload: false`), so no reload ever happened, `settle` restarted the container onto
    its OLD definition, and state recorded the new digest as if it had taken effect — permanently and
    silently. Fixed by gating the reload on `stale` (state's digest disagreeing with what was just
    rendered) too, the same signal `changed` already used to gate the restart.
  - **Restart-safety, interrupted CREATE (high, found on the coordinator's inline re-review).** The
    same bug for a resource with NO prior state: a create whose write landed but crashed before
    `daemon-reload` retried with `wrote: false` and no `stale` to disagree with either, so
    `verifyGenerated` threw on the still-missing generated unit forever — loud, but permanently
    stuck, since nothing about a plain retry ever changed any of those signals. Fixed with
    `needsVerificationReload` (`container-generator.ts`), sharing its predicate with
    `verifyGenerated` itself so the reload gate and the check it is gating can never disagree; an
    ordinary adoption whose generation was already proven fine still skips the extra reload.
  - **Secret leakage (high).** `containerProblems` only ran `secretLikeEnvironment` over
    `container.environment`; `exec`, `podmanArgs` (rendered verbatim) and the `unit.lines`/
    `service.lines` escape hatches (which can spell a raw systemd `Environment=` outside the typed
    map entirely) were unchecked. Fixed with `secretLikeLines` (the same value-shape and embedded
    `KEY=VALUE` heuristics, run over every other rendered line) and an outright refusal of `-e`/
    `--env` in `podmanArgs` (`podmanArgsProblems`), both in container-secrets.ts and wired into
    `containerProblems`.

  Regression tests for all three live in container-generator.test.ts ("an interrupted apply that
  crashed before daemon-reload", "an interrupted CREATE that crashed before daemon-reload") and
  container-secrets.test.ts (one per affected field); each was confirmed to fail without its fix.

- [#237](https://github.com/taslabs-net/homeflare-kit/pull/237) [`1c90063`](https://github.com/taslabs-net/homeflare-kit/commit/1c9006369dd623c522a0a1c0e747582800a4d981) Thanks [@taslabs-net](https://github.com/taslabs-net)! - New `@homeflare/alchemy/unifi` subpath: `Unifi.Network` and `Unifi.FirewallZone`,
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

### Patch Changes

- [#243](https://github.com/taslabs-net/homeflare-kit/pull/243) [`823c1a8`](https://github.com/taslabs-net/homeflare-kit/commit/823c1a88fe1f8d34b90acb576231a18b7b04f0c3) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The `proxmox/*` family's `nodes/storage` sub-area (decision 43's serial proxmox walk-down, PR 3
  after `access` in PR 231/239) migrates `Proxmox.Storage` off `client.ts`'s hand-rolled `pve()`
  (`resource.ts`'s `pveHandlers`) onto `@distilled.cloud/proxmox`'s typed `storage.getStorage`/
  `createStorage`/`putStorage`/`deleteStorage` — the first resource of this sub-area; the rest of
  `nodes`/`storage` (ZFS pools, Ceph, node network) follows in later PRs, split out because each is
  independently substantial (see this PR's own description for why). `storage-wire.ts` (the read
  side) and `storage-form.ts` (the write side) hold the pure wire-shape functions, the
  api-token.ts/api-token-form.ts seam.
