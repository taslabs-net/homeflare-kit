# Ceph mon-command transport — auth entities and config options

Status: active — design spike for K-A4 (`Ceph.AuthEntity`) and K-D's
`CephConfigOption`; retire when both land built to the signed-off design
Verified: 2026-09-26

Design 2 of the two docs gating Talos-on-PVE work (the PVE→Talos gate plan,
2026-09-26). Companion:
[2026-09-26-talos-secrets-flow.md](./2026-09-26-talos-secrets-flow.md).
Timing: with-Talos, before ceph-csi — this is **not** a Talos-start gate item.
⛔ This repo is public: no hostnames, addresses or secret values appear here.

## The gap, measured

- ceph-csi needs a Ceph auth entity scoped to the `k8s-rbd` pool
  (`client.k8s-rbd` with rbd profiles), and cluster tuning needs
  `ceph config set`. Both are mon-commands.
- The pinned PVE 9.2.11 schema
  (`packages/distilled-proxmox/src/services/nodes.ts`) exposes
  `/nodes/{node}/ceph/cfg` + `cfg/raw` + `cfg/value` + `cfg/db` — all
  `method: "GET"` (`:5329,5352,10361,10385`) — and **no `ceph auth` endpoint
  at all** (grep over the vendored schema, 2026-09-26, zero hits). MEASURED:
  PVE's API can read Ceph config and can never create an auth entity or set a
  config option.
- Pools, OSDs and daemons stay on the PVE API
  (`POST /nodes/{node}/ceph/pool`, `ceph-pool-wire.ts:85`). This design adds a
  transport only for what the API lacks — it replaces nothing that works.

## Measure first (the standing read lane)

Before any declaration, a coordinator runs a read-only inventory over the lane
the estate already sanctions for PVE reads (ssh + `sudo -n`, decision 31; the
node-check stack deploys over the same lane):

- ⛔ **`ceph auth ls` PRINTS EVERY KEY.** The inventory read filters **on the
  node**, before anything leaves it — `ceph auth ls -f json` piped through a
  filter that deletes each `"key"` field — so no key material ever enters a
  transcript. Record entity names, caps and the date.
- `ceph config dump -f json` (no keys, safe as-is) for the live config options.
- Expected (REASONED, the read verifies): the stock PVE entities
  (`client.admin`, `client.bootstrap-*`, mgr/osd keyrings) plus the client PVE
  storage uses; no `client.k8s-*` yet.
- ★ Existing auth entities are recorded as observed inventory only — **never
  adopted**: adopting one would mean reading and fingerprinting its key, and a
  key is only ever handled for an entity this stack owns.

## Transport options

**T-A (recommended): ssh/sudo runner with an exact-argv allowlist.**

- The lane above, made writable one shape at a time: `sudo -n /usr/bin/ceph …`
  on one mon node, driven by the deploy process.
- Kit shape: the linux family's allowlist discipline
  (`packages/alchemy/src/linux/sudo-allowlist.ts` — shapes, not programs:
  fixed subcommand, fixed flags, bounded operands, unit-tested without ssh) as
  a new `ceph-cli` module in the proxmox family. Allowed shapes only:
  `auth get-or-create`, `auth get`, `auth caps`, `auth del`,
  `config set|rm|get`. ⛔ `auth ls` is refused by shape (key-printing,
  unbounded); `auth get` already returns the one key being reconciled, so
  nothing wider is ever needed.
- Pros: zero new daemons, zero new standing credentials, no new network path —
  the deploy host already reaches the nodes' ssh. Cons: the allowlist is
  client-side discipline (the ssh user's sudoers is unrestricted; server-side
  narrowing is decision D4), and mon quorum + anchor-node reachability become
  deploy preconditions.

**T-B: Ceph mgr `restful` module.** Deprecated upstream in favor of the
dashboard (REASONED — re-verify against the installed Ceph release before ever
choosing it). Bootstrapping it is itself a mutation (`ceph mgr module enable`,
TLS cert, API key) that needs T-A or hands once, and it adds a standing
credential class plus a listener on the cluster network.

**T-C: Ceph dashboard REST API.** Not enabled on a stock PVE Ceph (REASONED);
the same bootstrap paradox and standing-credential cost as T-B.

**T-D: librados `mon_command` with a dedicated keyring.** Needs a native
binding (a second SDK, which the doctrine forbids when the vendor's operator
surface is a CLI), mon-network reachability the deploy host does not have, and
distributing the bootstrap keyring is itself a transport problem.

★ Recommendation: **T-A**. T-B, T-C and T-D each need T-A (or hands) at least
once to come into existence — a transport that bootstraps through its rival is
not an alternative, it is a dependency.

## `Ceph.AuthEntity` (K-A4)

- Props: `entity` (`client.k8s-rbd`), `caps` map (`mon: 'profile rbd'`,
  `osd: 'profile rbd pool=k8s-rbd'`, `mgr: 'profile rbd pool=k8s-rbd'`),
  `target` (OpenBao mount + key for where the key lands), `node` (transport
  anchor).
- Reconcile (observe → ensure → sync): `auth get <entity>` (absent → create
  path) → `auth get-or-create` with the declared caps (idempotent by Ceph's
  own contract; caps drift → `auth caps`) → capture the key **in memory only**
  → write it to OpenBao via stdin (⛔ never argv — process lists would print
  it; never a temp file) → attributes: entity, caps, `sha256(key)` fingerprint,
  bao path. Delete: `auth del`, idempotent (absent = success), guarded by
  `retain` like every destructive family.
- ⛔ The stdout of `auth get*` holds the key: error paths report stderr only
  (the `talos/credentials.ts:83` rule), and the runner's per-call log line
  prints argv, never output.
- Rows are creates through the first-create gate, no `adopt()`. The consuming
  side — the ceph-csi secret inside k8s reading the key from the vault — is
  its own design when the k8s consumer path exists; one line here on purpose.

## `CephConfigOption` (K-D)

- Read/diff over the PVE API: `GET /nodes/{node}/ceph/cfg/db` (measured above)
  — planning needs no ssh. Writes go through the same T-A shapes
  (`config set <who> <name> <value>`, `config rm`).
- Existing live options become adopt-only rows (`adopt(true)` + retain —
  config values are readable, unlike auth keys); new options are creates
  through the gate. ⚠️ The operator's pending `ceph config rm` of the dead
  `public_addr` entries runs **before** any adopt, so fossils are never
  adopted into state.

## Risks

- Key exposure is the whole game: one stray log line ships a cluster
  credential into a transcript. The family gets a structural test over its own
  source (no output-logging) plus fake-runner tests asserting the key never
  reaches state, logs or argv.
- Ceph CLI output drifts across releases: every parsed literal is recorded
  with the measured Ceph version and date (the doctrine's brief rule); parse
  `-f json` everywhere, never human-format output.
- A down anchor node must read as a transport error, never as "absent →
  recreate" — the transient-read-propagates test every family carries.
- The allowlist narrows what the _kit_ will run, not what the ssh user _could_
  run; D4 decides whether the server side narrows to match.

## Tim must decide

- **D1** Transport anchor: one fixed mon node, or try-in-order across the
  three TB4 nodes.
- **D2** Where the key lands: the Talos cluster's mount under `ceph/<entity>`
  (recommended — one consumer, one mount) vs a separate ceph mount.
- **D3** `auth del` enabled behind `retain` (recommended) vs delete refused
  entirely.
- **D4** Server-side sudoers narrowing for the ceph shapes (a separate
  operator step on each node) — want it now, or accept client-side allowlist
  discipline first?
- **D5** Confirm T-A over T-B/C/D.

## Acceptance tests

1. Allowlist units (no ssh): every allowed shape accepted byte-for-byte;
   `auth ls`, bare `ceph`, unexpected flags and extra operands refused with
   the typed refusal.
2. Fake-runner provider tests: create-of-absent runs `get-or-create` once; a
   second reconcile is zero writes (converged); caps drift plans `update` and
   runs exactly `auth caps`; delete-of-absent succeeds; a failed ssh
   propagates as a transport error, never as absent.
3. Secret handling: attributes and state fixtures carry the fingerprint and
   never the key; the vault write goes via stdin (a test asserts argv carries
   no key bytes); no log line carries stdout.
4. Live measurement (coordinator, read-only, before any build): the filtered
   `auth ls` inventory and `config dump` recorded in the estate's proxmox
   checkout with command + date.
5. Post-deploy: the operator's `bao kv get` fingerprint equals the state
   fingerprint; the verify pass reads the entity row noop with zero
   refused-read warnings; `ceph auth get client.k8s-rbd` (key filtered on the
   node) shows exactly the declared caps.
