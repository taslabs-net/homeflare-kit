# CephConfigOption — reads over the PVE API, writes over the ceph-cli transport

Status: active — design for K-D's `CephConfigOption`; retire when it lands
built to the signed-off design
Verified: 2026-09-26 (red-team findings applied same date)

Part of the design suite gating Talos-on-PVE work. Companion:
[Ceph transport](./2026-09-26-ceph-mon-transport.md) — the T-A transport,
its allowlist, lockout-safety and inventory rules all apply here; this doc
adds only what is specific to config options.
⛔ This repo is public: no hostnames, addresses or secret values appear here.

## Shape

- Read/diff over the PVE API: `GET /nodes/{node}/ceph/cfg/db` (MEASURED,
  `packages/distilled-proxmox/src/services/nodes.ts:10431`) — planning needs
  no ssh and never elevates. Writes go through the companion's T-A shapes:
  `config set <who> <name> <value>`, `config rm <who> <name>`.
- Existing live options become adopt-only rows (`adopt(true)` + retain);
  new options are creates through the first-create gate. ⚠️ The operator's
  pending `ceph config rm` of the dead `public_addr` entries (T3) runs
  **before** any adopt, so fossils are never adopted into state.

## The named option list — bounded operands, no secrets

- ⛔ **Only a named list of options may ever be declared, adopted, read by
  value, or written.** The list starts empty and each addition is a reviewed
  PR line. The lockout classes are refused by the allowlist itself, not by
  convention: `mon_host`, `public_network`, `cluster_network`, `public_addr`,
  `cluster_addr`, `auth_*_required` and every `keyring`/`key`-bearing option
  — one wrong write here re-addresses the mons or de-authenticates the whole
  cluster, which cuts every VM disk.
- ⛔ **No secret-valued option is ever on the list.** mgr module options can
  hold passwords (REASONED), which is why `config dump` is inventoried as
  `{who, name}` only (companion doc) and why adoption reads values only for
  named options — an adopt must never copy an unvetted value into state.
  A secret-bearing setting belongs in a vault-backed flow, not this family.
- ⚠️ `config set` puts the VALUE in argv — the runner's log, the node's sudo
  journal and any process list see it. Acceptable exactly because the named
  list carries no secrets; this is a design invariant, not an accident.

## Risks

- The T3 ordering is load-bearing: adopt before the `public_addr` cleanup and
  the fossils become declared state that a later deploy would re-assert.
- A config option's effective value can come from several sources (mon db,
  ceph.conf, defaults); the diff compares against the mon-db value the PVE
  API reports (`cfg/db`), and says so — a ceph.conf override is out of scope
  for this family (CephConf is its own K-D item, GET-only).

## Tim must decide

- **D-C1** Confirm the named-list discipline (options added one reviewed PR
  line at a time) and its initial contents: the tuning options you actually
  intend to manage — or start with an empty list and only the T3 `config rm`.

## Acceptance tests

1. Allowlist units: `config set|rm|get` accepted only for options on the
   named list; the lockout classes above and any unlisted option refused with
   the typed refusal; `<who>` bounded to the declared daemons.
2. Fake-runner tests: adopt reads the value via the PVE API (no ssh in plan);
   a value change plans `update` and runs exactly one `config set`; delete
   (where declared) runs `config rm` and is idempotent; a failed read
   propagates, never "absent".
3. Structural: the named list contains none of the refused classes (a test
   enforces the deny patterns against the list itself).
4. Live: the T3 `config rm` entries are gone from the inventory read before
   the first adopt row is declared.
