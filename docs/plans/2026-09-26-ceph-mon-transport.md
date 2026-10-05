# Ceph mon-command transport — auth entities via ssh/sudo

Ledger row: talos-k8s

Status: active — design spike for K-A4 (`Ceph.AuthEntity`); retire when it
lands built to the signed-off design
Verified: 2026-09-26 (red-team findings applied same date)

Part of the design suite gating Talos-on-PVE work. Companions:
[secrets flow](./2026-09-26-talos-secrets-flow.md) ·
[config options](./2026-09-26-ceph-config-options.md) (same transport) ·
[stack + first boot](./2026-09-26-talos-stack-first-boot.md).
Timing: with-Talos, before ceph-csi — **not** a Talos-start gate item.
⛔ This repo is public: no hostnames, addresses or secret values appear here.

## The gap, measured

- ceph-csi needs a Ceph auth entity scoped to the `k8s-rbd` pool
  (`client.k8s-rbd` with rbd profiles), and cluster tuning needs
  `ceph config set`. Both are mon-commands.
- The pinned PVE 9.2.11 schema
  (`packages/distilled-proxmox/src/services/nodes.ts`) exposes
  `/nodes/{node}/ceph/cfg` + `cfg/raw` + `cfg/value` + `cfg/db` — all
  `method: "GET"` (`:5375,5398,10407,10431`) — and **no `ceph auth` endpoint
  at all** (grep over the vendored schema, 2026-09-26, zero hits). MEASURED:
  PVE's API can read Ceph config and can never create an auth entity or set a
  config option.
- Pools, OSDs and daemons stay on the PVE API
  (`POST /nodes/{node}/ceph/pool`, `ceph-pool-wire.ts:85`). This design adds a
  transport only for what the API lacks — it replaces nothing that works.

## Measure first (read-only inventory)

Before any declaration, a coordinator runs a read-only inventory over the lane
the estate already sanctions for PVE reads (ssh + `sudo -n`, decision 31):

- ⛔ **`ceph auth ls` PRINTS EVERY KEY, and exclusion filters are how the
  estate last leaked a token** (the 2026-09-25 AI Gateway lesson: allowlist
  extraction only, never delete-the-secret-field). The inventory therefore
  runs a **committed, tested read script** (homeflare-proxmox `scripts/`)
  that executes `ceph auth ls -f json` **on the node** and prints only the
  named fields `{entity, caps}` — nothing else ever leaves the node. Record
  entity names, caps and the date.
- `ceph config dump` goes through the same script printing `{who, name}` only.
  ⚠️ NOT "safe as-is": mgr module options can hold passwords (REASONED), so
  values are never printed wholesale — the config-options companion says
  which named options may ever have a value read.
- Expected (REASONED, the read verifies): the stock PVE entities
  (`client.admin`, `client.bootstrap-*`, mgr/osd keyrings) plus the client PVE
  storage uses; no `client.k8s-*` yet.
- ★ Existing auth entities are recorded as observed inventory only — **never
  adopted**: adopting one would mean reading and fingerprinting its key, and a
  key is only ever handled for an entity this stack owns.

## Transport options

**T-A (recommended): ssh/sudo runner with an exact-argv allowlist.**

- `sudo -n /usr/bin/ceph …` on one mon node, driven by the deploy process.
  Kit shape: the linux family's allowlist discipline
  (`packages/alchemy/src/linux/sudo-allowlist.ts` — shapes, not programs:
  fixed subcommand, fixed flags, bounded operands, unit-tested without ssh)
  as a new `ceph-cli` module. Allowed shapes: `auth get-or-create`,
  `auth get`, `auth caps`, `config set|rm|get`, `quorum_status`.
  ⛔ `auth ls` is refused by shape (key-printing, unbounded); `auth get`
  already returns the one key being reconciled. `auth del` is D3.
- ⛔ **Operands are bounded, not free** (the house lockout-safety pattern):
  the entity operand must match the declared prefix `client.k8s-` — the
  allowlist refuses `client.admin`, `mon.`, `osd.`, `mgr.`, the PVE storage
  client and anything else, so no shape can touch the keyrings the cluster
  or the VM disks run on. Config operands are bounded by the companion doc's
  named option list.
- ⛔ **Honest identity: every command runs as `client.admin`** (the node's
  admin keyring) with root via sudo. "Zero new standing credentials" is true
  and still means the transport's effective identity is full cluster admin —
  the allowlist is what narrows it, and only client-side (D4).
- ★ Lockout safety (the ufw-established model): additive-only by default
  (D3 recommends refusing deletes), and after every write the runner re-runs
  `quorum_status` **on a fresh second connection** and fails the row if
  quorum degraded — never auto-repair, never continue.
- ⛔ **T-A is a new decision, not an extension of 31.** Decision 31 sanctions
  `sudo -n pvesh get` **reads**; a write lane over ssh needs Tim's explicit
  sanction — that is D5, not fine print.
- Cons: the allowlist is client-side discipline (the ssh user's sudoers is
  unrestricted — `(ALL) NOPASSWD: ALL`, measured in
  homeflare-proxmox `docs/node-check.md:137-141`; server-side narrowing is
  D4), and mon quorum + anchor reachability become deploy preconditions.

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

- Props: `entity` (must match the bounded prefix), `caps` map
  (`mon: 'profile rbd'`, `osd: 'profile rbd pool=k8s-rbd'`,
  `mgr: 'profile rbd pool=k8s-rbd'`), `target` (OpenBao mount + key — the
  secrets doc's `data/ceph/*` write carve is the matching policy change),
  `node` (transport anchor).
- ⛔ **A plan never elevates** (`linux/sudo-runner.ts:11-12`; node-check: only
  apply calls elevate). So `diff`/verify for this family compare props against
  **state only** — no ssh, no sudo, no key material in the plan process. Live
  drift is caught at reconcile (which elevates, on the admin lane) and by the
  post-deploy operator check; verify honestly cannot prove live convergence
  for this family and says so.
- Reconcile (observe → ensure → sync, ordered for M4): `auth get <entity>` →
  **present**: compare caps, differ → exactly `auth caps` (⚠️ `get-or-create`
  on an existing entity with different caps errors — REASONED, hence the
  explicit branch) → **absent** (proven by a successful read): `auth
get-or-create` with the declared caps → capture the key **in memory only**
  → write it to OpenBao via stdin (⛔ never argv, never a temp file) →
  attributes: entity, caps, `sha256(key)` fingerprint, bao path.
- ⛔ **DECISION 65 (Tim, 2026-09-26) AMENDS THIS: no node-side shell filter for
  `auth get`.** Its full stdout (key included) may be read directly on
  **every** reconcile now, not only create — the key is parsed out and
  dropped in the reconcile process's **own memory** before anything is
  logged, returned or stored, the same in-memory discipline the create path
  above already uses (one fewer script to maintain per mon node). Error paths
  stay stderr-only (never echo stdout on failure, `talos/credentials.ts:83`'s
  rule), and the runner's per-call log line prints argv, never output; tests
  prove the key never reaches a log line, a return value or a state fixture
  on the create, no-op, caps-drift or failure path
  (ceph-auth-parse.test.ts, ceph-auth-reconcile.test.ts,
  ceph-auth-reconcile-secrecy.test.ts).
- Rows are creates through the first-create gate, no `adopt()`. The consuming
  side — the ceph-csi secret inside k8s reading the key from the vault — is
  its own design when the k8s consumer path exists; one line here on purpose.

## Risks

- Key exposure is the whole game: one stray log line ships a cluster
  credential into a transcript — including from `auth get`'s unfiltered
  stdout, read on every reconcile since decision 65, not only on create. The
  family gets a structural test over its own source (no output-logging) plus
  fake-runner tests asserting the key never reaches state, logs or errors on
  the create, no-op, caps-drift or failure path.
- Ceph CLI output drifts across releases: every parsed literal is recorded
  with the measured Ceph version and date; parse `-f json` everywhere.
- A down anchor node must read as a transport error, never as "absent →
  recreate" — the transient-read-propagates test every family carries.
- The allowlist narrows what the _kit_ will run, not what the ssh user _could_
  run; D4 decides whether the server side narrows to match.

## Tim must decide

- **D1** Transport anchor: one fixed mon node, or try-in-order across the
  three TB4 nodes.
- **D2** Where the key lands: the Talos cluster's mount under `ceph/<entity>`
  (recommended — one consumer, one mount, and the write carve already scopes
  it) vs a separate ceph mount.
- **D3** `auth del`: **refused entirely (recommended** — the lockout-safety
  rule is "never auto-delete", and a wrong delete here cuts VM disks) vs
  enabled behind `retain` with the bounded-prefix guard.
- **D4** Server-side sudoers narrowing for the ceph argv shapes (a separate
  operator step on each node) — now, or accept client-side discipline first?
- **D5** Confirm T-A over T-B/C/D — ⛔ confirming it **sanctions a write lane
  over ssh whose effective identity is `client.admin`**, a new decision
  extending 31, bounded by the allowlist above.
- **D6** Which stack owns `Ceph.AuthEntity` — every option moves a standing
  boundary, so this is explicitly Tim's call:
  - `alchemy.talos.ts`: the TalosProvisioner stack gains root-equivalent ssh
    on the hypervisors — cancels its least-privilege premise.
  - `HomeFlareProxmox`: the API stack gains an ssh lane.
  - `HomeFlarePveNode`: decision 32 says NO OpenBao (`alchemy.node.ts:5-7`),
    and the key must land in OpenBao.
  - **A new small `alchemy.ceph.ts` stack (recommended):** own state, exactly
    the ssh+sudo transport and the bao write carve, nothing else — every
    existing boundary stays intact at the cost of one more stack
    (`docs/stacks.md`'s one-stack-per-system reading: cluster-level Ceph is
    its own system).

## Acceptance tests

1. Allowlist units (no ssh): every allowed shape accepted byte-for-byte;
   `auth ls`, `auth del` (if D3 = refuse), bare `ceph`, unexpected flags,
   extra operands, and any entity outside `client.k8s-` (including
   `client.admin` and the PVE storage client) refused with the typed refusal.
2. Fake-runner provider tests: create-of-absent runs `get-or-create` once; a
   second reconcile is zero writes; caps drift runs exactly `auth caps` (never
   `get-or-create` on an existing entity); a failed ssh propagates as a
   transport error, never as absent; after every write the runner issues
   `quorum_status` on a fresh connection and a degraded answer fails the row.
3. Secret handling: attributes and state fixtures carry the fingerprint and
   never the key; the vault write goes via stdin (a test asserts argv carries
   no key bytes); no log line carries stdout; plan/diff spawn no ssh at all.
4. Live measurement (coordinator, read-only, before any build): the committed
   script's `{entity, caps}` and `{who, name}` inventories recorded in the
   estate's proxmox checkout with command + date.
5. Post-deploy (operator): the `bao kv get` fingerprint equals the state
   fingerprint; `ceph auth get client.k8s-rbd` (filtered on the node) shows
   exactly the declared caps.
