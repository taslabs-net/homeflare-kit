# Talos secrets flow — machine config, talosconfig and machine secrets from OpenBao

Ledger row: talos-k8s

Status: active — design gate for K-A3 (Talos resource rework) + lane O1 (OpenBao
mount/policy); retire when the K-A3 release lands built to the signed-off design
Verified: 2026-09-26 (red-team findings applied same date)

Part of the design suite gating Talos-on-PVE work (the PVE→Talos gate plan,
2026-09-26; Tim's answers of the same date are the requirements below). Suite:
this doc · [stack + first boot](./2026-09-26-talos-stack-first-boot.md) ·
[networking](./2026-09-26-talos-networking.md) ·
[Ceph transport](./2026-09-26-ceph-mon-transport.md) ·
[Ceph config options](./2026-09-26-ceph-config-options.md).
Convention: landscape `docs/plans/README.md`. ⛔ This repo is public: no
hostnames, addresses, token ids or secret values appear here (node names
already appear in this repo's `packages/alchemy/docs/linux-sudo.md`).

## Measured today (2026-09-26, read-only)

- `Talos.MachineConfig` reads `configFile` from disk resolved against
  `STACK_DIR = new URL('..', import.meta.url)`
  (`packages/alchemy/src/talos/talos-machine-config.ts:20,61,102`) — the kit's
  own install directory. MEASURED. A consuming stack's config would have to sit
  inside `node_modules/@homeflare/alchemy/`; no consumer can use it as shipped.
- A rendered Talos machine config embeds the cluster CA private key and the
  bootstrap token (REASONED from the `talosctl gen config` output shape, Talos
  v1.13 docs; the file's own header says so at `:7-8`). Today's design therefore
  puts CA key material on repo disk.
- ⛔ `talos/credentials.ts` HAS THE RIGHT INGREDIENTS AND A BROKEN LIFETIME —
  MEASURED (red-team scratch run of the exact shape on the pinned
  effect 4.0.0-rc.115: the file is gone when the caller uses it).
  Mint-at-reconcile, the 0600 `wx` create and stderr-only errors are all right.
  But `mintTalosconfig` wraps its whole body in `Effect.scoped`
  (`credentials.ts:51`) and registers the delete finalizer inside that scope
  (`:127-132`), so the scope closes — and the temp file is deleted — the moment
  the mint returns. Every current caller hands talosctl a path to a deleted
  file, and the swallowing reads downstream (`orElseSucceed`) disguise that as
  "not converged". K-A3 rebuilds the mint as `acquireRelease` with the file's
  lifetime owned by the caller's own `Effect.scoped`. ⚠️ This defect ships on
  kit main today, independent of every decision below.
- ⚠️ The credentials header is REASONED-not-measured and wrong twice: the
  consuming stacks use the shared Cloudflare HTTP state store, not the Postgres
  it names (homeflare-proxmox `AGENTS.md`, "Alchemy"), and the pinned
  alchemy 2.0.0-beta.79 persists `Redacted` under the marker `__redacted__`
  (`alchemy/src/State/StateEncoding.ts:10`), not `{"@redacted": …}`. The rule
  it derives — state is unencrypted, nothing secret in props, attributes or
  logs — is right either way; K-A3 corrects the header, not the rule.
- `talos/values.ts:38-66` keeps kubeconfig material out of state (endpoint +
  fingerprints only). MEASURED. ⚠️ But `Talos.Kubeconfig` itself writes a
  cluster-admin kubeconfig to `runtimePath` on host disk and never removes it
  (`kubeconfig.ts` reconcile: `talosctl kubeconfig <runtimePath>`), and its
  read depends on that file — verify from any other host plans `update`
  forever, and the file is the same keys-on-disk class O-C below is rejected
  for. K-A3's scope includes it: the kubeconfig lands in the vault (a
  `kubeconfig` key on the mount) and consumers mint it the way the
  talosconfig is minted.

## Requirements (Tim, 2026-09-26)

- Separate stack `alchemy.talos.ts` with its own state; first VMs node-pinned,
  HA off (details: the [stack + first boot](./2026-09-26-talos-stack-first-boot.md) doc).
- ⛔ Nothing secret in Alchemy state, props, argv or logs.
- Talos VM and StorageDownload rows are creates through the first-create gate,
  **no `adopt()`**.
- The OpenBao mount + policy is lane O1 (homeflare-openbao); every grant edit
  lands in **both** live policy sets (Tim, 2026-09-25: "Edit both").

## Options — where the machine config lives

**O-A (recommended): full rendered config in OpenBao; digest pinned in the repo.**

- One-time operator step (never an agent): `talosctl gen secrets` +
  `talosctl gen config --with-secrets` on the operator's machine; write
  `secrets.yaml`, the talosconfig and each node's rendered config into the
  mount (values via `@file`/stdin, ⛔ never argv); delete the local files.
  The seeded config must already carry the CNI and kube-proxy settings the
  first-boot doc requires — the seed checklist lives there.
- Props become `{ node, target: { mount, cluster }, configKey, configDigest }`
  — the sha256 of the KV content, pinned in git. No `configFile`, no disk read;
  `STACK_DIR` is deleted with it.
- Reconcile: mint the KV value → verify `sha256(content) === configDigest`
  (mismatch = typed error, fail closed, nothing applied — a poisoned or
  fat-fingered KV write cannot silently reach a node) → 0600 `wx` temp file
  acquired with `acquireRelease` in the resource's own scope (the ingredients
  of `credentials.ts:102-132` with the lifetime defect above fixed) →
  `talosctl apply-config` → bounded read-back (the first-boot doc defines
  `converged` per apply mode — the shipped whole-output hash can never match).
- State carries digest, node, mode, converged — nothing else.
- ★ The digest is `sha256(canonicalText(content))` — trailing whitespace
  trimmed (`values.ts:10`) — so a plain `sha256sum` of a newline-terminated
  file prints a DIFFERENT hash. K-A3 ships a kit command that reads the KV
  value and prints only the digest; the operator pins what it prints and
  computes nothing by hand.
- ★ A config change is two artifacts on purpose: the operator writes a new KV
  version AND a PR bumps the pinned digest. Auditable in both places; neither
  alone can change a node.

**O-B: secret-free template in the repo; secrets only in OpenBao; render at
reconcile.** Reviewable YAML diffs in git, but `talosctl gen config` is a
cluster-level generator, not a per-node patcher; a reconcile-time render makes
the digest depend on the talosctl version; and every render step is REASONED
with no live cluster to measure. More moving parts for the guarantee O-A's
pinned digest already gives. Viable fallback if Tim wants config diffs in git.

**O-C: keep the disk file, fix only `STACK_DIR`.** Rejected: CA keys and the
bootstrap token stay on repo disk, in every checkout and backup.

⚠️ O-A's cost: `diff` needs KV reads too (it mints a talosconfig to read the
live digest), so _planning_ needs vault access — decision D2 below.

## O1 — OpenBao mount + policy

- New KV-v2 mount `talos-<cluster>` (D1 names the cluster; `credentials.ts`'s
  example is `talos-c1`). Keys, as CLI paths — `bao kv get` inserts the KV-v2
  `data/` API segment itself: `secrets` (secrets.yaml), `talosconfig`,
  `kubeconfig` (deploy-written once, per the measured kubeconfig note above),
  `nodes/<node>` (rendered config), `ceph/<entity>` (companion doc).
  ⚠️ `talosconfigKey`'s shipped default `data/talosconfig`
  (`credentials.ts:42`) therefore reads `<mount>/data/data/talosconfig` — it
  fails closed, but it would block the first deploy; K-A3 fixes the default
  to `talosconfig`.
- ⛔ WHERE THE MOUNT LIVES IS CONSTRAINED BY WHO DIALS IT. The Talos deploy
  mints its PVE token from the `proxmox-tb4` engine, which lives on the mini's
  vault (`homeflare-proxmox src/mini-bao.ts:4-6`), and `child-env.ts` hands
  the deploy child exactly one vault address ("THE CHILD TALKS TO THE BAO THIS
  WRAPPER CHOSE, AND NO OTHER" — inherited addresses are stripped on purpose);
  `mintTalosconfig` inherits that env (`extendEnv: true`) and `TalosTarget`
  carries no address. One process, one vault. So the draft's "target-primary
  (VPS) only" recommendation was unreachable from the lane that deploys.
  Options:
  - **Mini's vault now, plus an explicit entry in the consolidation copy-list
    (recommended).** Works with the wrapper exactly as it is. The copy-list
    entry is the price — the trap the draft tried to dodge, now carried
    openly instead of dodged into unreachability.
  - Per-target vault address + a second login: rejected — it re-opens the
    exact leak `child-env.ts` closes (a deploy token riding to a
    shell-chosen address).
  - Wait for the `proxmox-tb4` engine's own move to the VPS vault, then mount
    there: couples Talos start to the vault-consolidation timeline. Tim may
    choose that knowingly.
- Policy `talos-provision`: read+list on the mount's `data/*` + `metadata/*`,
  **plus write on `data/ceph/*` only** — the Ceph companion's deploy lane
  lands entity keys there. ⛔ The carve never covers `secrets`, `talosconfig`,
  `kubeconfig` or `nodes/*`: CA-material writes stay operator-only — the
  deploy lane must never be able to rotate the cluster CA it authenticates
  with. (Exception: the `kubeconfig` key is written by the deploy lane once
  at cluster bring-up; its write grant is that one key, not the mount.)
- Who holds `talos-provision`: the admin/deploy login only. With D2's
  recommended answer, `plan:talos` and verify run on the admin lane too.
- O1 also carries the vault half of K-A0: a new `proxmox-tb4` engine role for
  `TalosProvisioner` (the PVE-side role is K-A0's kit half). Every grant edit
  — mount, policy, engine role — lands in **both** live policy sets.
- ⛔ Declaring the mount never writes a secret into it; seeding `secrets` is an
  operator step, the same split homeflare-openbao's proxmox engine mounts
  document for `<mount>/config`.

## Risks

- ⛔ Digest pinning means two artifacts can drift (KV rewritten, PR not merged):
  failing closed is the design, but a stuck mismatch blocks every Talos deploy
  until the pair reconciles. Mitigation: the typed error names both digests.
- ⚠️ Everything talosctl is REASONED from v1.13 docs (`talos/resource.ts:15-16`);
  the first maintenance-mode apply is the first measurement — and ⛔ never a
  `--dry-run` (it prints secrets; the first-boot doc owns that rule).
- ⚠️ A SIGKILL strands a 0600 temp config on the deploy host —
  `credentials.ts:112-113` accepts the same for the talosconfig; same argument.
- D2 = agent-lane read would put CA-carrying material within a compromised
  plan lane's reach; that is why D2 is a decision, not a default.

## Decided (Tim, 2026-09-26 — decision 61: kit PR 295's recommendations, ALL accepted)

- **D1** Mount placement: mini's vault, `talos-c1`, with an explicit
  consolidation copy-list entry — decision 64 names the first grants this
  unlocks: the mount, `talos-provision` policy and a `TalosProvisioner` mint
  tier on `proxmox-tb4`.
- **D2** The agent plan lane is DENIED on the Talos mount — plans and verify
  run admin/operator-only, exactly the recommended default.
- **D3** O-A confirmed: all-in-vault, digest pinned in git. O-B not built.

(The VLAN/BGP and vmid decisions moved with their sections to the companions.)

## Acceptance tests

1. Kit unit (fake `bao` spawner): digest mismatch → typed error, no talosctl
   spawn, no temp file left behind. Match → argv is exactly
   `apply-config --file <tmp> --mode <m>`; the temp file **exists, is 0600 and
   was created `wx` at the moment the fake talosctl spawns**, and is gone
   after the caller's scope closes — the lifetime assertion today's build
   fails (C1 above); "gone after scope exit" alone would pass the broken shape.
2. Kit structural: `MachineConfigProps` has no `configFile`; no talos prop,
   attribute or argv carries config bytes; state fixtures contain no PEM or
   token strings (grep gate in the family's tests).
3. O1: `bao policy read talos-provision` equals the repo join; an agent-lane
   token is denied on the mount's `data/secrets` (D2 = no); the deploy login
   **can** write `data/ceph/<entity>` and **cannot** write `data/secrets`,
   `data/talosconfig` or `data/nodes/<node>`; the KV-v2 mount exists where D1
   placed it, and its copy-list entry exists if D1 chose the mini.
4. The digest read-back and first-boot ordering tests live in the
   [stack + first boot](./2026-09-26-talos-stack-first-boot.md) doc (it owns
   `converged`).
