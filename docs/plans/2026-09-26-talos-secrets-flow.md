# Talos secrets flow — machine config, talosconfig and machine secrets from OpenBao

Status: active — design gate for K-A3 (Talos resource rework) + lane O1 (OpenBao
mount/policy); retire when the K-A3 release lands built to the signed-off design
Verified: 2026-09-26

Design 1 of the two docs gating Talos-on-PVE work (the PVE→Talos gate plan,
2026-09-26; Tim's answers of the same date are the requirements below).
Companion: [2026-09-26-ceph-mon-transport.md](./2026-09-26-ceph-mon-transport.md).
Convention: landscape `docs/plans/README.md`. ⛔ This repo is public: no
hostnames, addresses, token ids or secret values appear here — node names and
repo names already appear in this repo's docs (`docs/linux-sudo.md`).

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
- `talos/credentials.ts:50-136` already has the right shape **for the
  talosconfig**: mint from OpenBao KV at reconcile (`bao kv get`), write a 0600
  `wx` temp file, finalizer removes it, errors report stderr only. MEASURED.
  ⚠️ Its header is REASONED-not-measured and names a Postgres state store; the
  consuming stacks actually use the shared Cloudflare HTTP state store
  (homeflare-proxmox `AGENTS.md`, "Alchemy"). The rule it derives is right for
  the wrong store — Alchemy state is unencrypted either way (`Redacted`
  persists as `{"@redacted": …}`) — so the header needs correcting, not the rule.
- `talos/values.ts:38-66` already keeps kubeconfig material out of state
  (endpoint + fingerprints only). MEASURED. Kubeconfig flow needs no redesign.

## Requirements (Tim, 2026-09-26)

- Separate stack `alchemy.talos.ts` with its own state; first VMs node-pinned,
  HA off.
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
- Props become `{ node, target: { mount, cluster }, configKey, configDigest }` —
  the sha256 of the KV content, pinned in git. No `configFile`, no disk read;
  `STACK_DIR` is deleted with it.
- Reconcile: mint the KV value → verify `sha256(content) === configDigest`
  (mismatch = typed error, fail closed, nothing applied — a poisoned or
  fat-fingered KV write cannot silently reach a node) → 0600 `wx` temp file +
  finalizer (exactly `credentials.ts:102-132`) → `talosctl apply-config` →
  read back the live digest (keep `talos-machine-config.ts:114-121`).
- State carries digest, node, mode, converged — nothing else.
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
live digest, `talos-machine-config.ts:79-90`), so _planning_ needs vault
access — decision D2 below.

## O1 — OpenBao mount + policy

- New KV-v2 mount `talos-<cluster>` (D1 names the cluster; `credentials.ts`'s
  example is `talos-c1`). Keys: `secrets` (secrets.yaml), `talosconfig`
  (`talosconfigKey`'s default `data/talosconfig` already matches,
  `credentials.ts:42`), `nodes/<node>` (rendered config), `ceph/<entity>`
  (companion doc).
- Policy `talos-provision`: read+list on that mount's `data/*` + `metadata/*`.
  ⛔ Writes stay operator-only — the deploy lane must never be able to rotate
  the cluster CA it authenticates with.
- ★ Recommend creating the mount on the estate's **target-primary vault only**
  (the consolidation plan's end state), not on the interim one: the mount is
  new, so placing it there keeps it out of the migration copy-list entirely
  (the measured trap: KV values present only on the interim vault read empty
  after an agent re-points). If Tim wants it on the interim vault instead, it
  joins that copy-list explicitly. Either way the grant lands in both policy
  sets.
- ⛔ Declaring the mount never writes a secret into it; seeding `secrets` is an
  operator step, the same split homeflare-openbao's proxmox engine mounts
  document for `<mount>/config`.

## The separate stack — alchemy.talos.ts

- Lives in homeflare-proxmox beside `alchemy.node.ts` (its `docs/stacks.md`:
  one stack per system). Own stack name, own rows in the shared state store,
  `plan:talos` / `deploy:talos`; deploys are operator-run on the admin lane.
- PVE credential: minted from the TB4 engine role bound to the new
  `TalosProvisioner` role/user (K-A0 — Tim: separate TB4-only role, least
  privilege; the old apply token joins the retire list).
- Rows, all creates through the first-create gate, no `adopt()`:
  `Proxmox.StorageDownload` (checksum-pinned Talos image, K-A2, after the
  storage-content `import` update), `Proxmox.Vm` ×N node-pinned with HA off
  (kit `qemu-read` fails a plan whose vmid moved nodes — a migration is not an
  update), then per node `Talos.MachineConfig` (O-A props, `after:` its VM
  row), `Talos.Bootstrap` once, `Talos.ClusterHealth` as the gate row,
  `Talos.Kubeconfig` (fingerprints only).
- ⛔ No VM prop carries machine config bytes or `cipassword` (K-A1 rule).

## Networking (coordinator default until Tim says otherwise)

**Default: VLAN-aware vmbr bridges + Cilium BGP inside k8s, peering to the
UniFi/OPNsense routers.** VM NICs attach to an existing bridge with a dedicated
VLAN tag; PVE SDN stays measured-none, so no SDN apply ever runs — an apply
reloads networking on every node and the Ceph fabric rides on it
(homeflare-proxmox `docs/sdn.md`). Service VIPs are advertised by Cilium BGP
via Helm + CRDs — the dogfood decision record
([PR 253](https://github.com/taslabs-net/homeflare-kit/pull/253), open as of
2026-09-26; `packages/alchemy/docs/talos-argocd-dogfood.md` once merged)
already fixes Cilium as Helm+CRDs, no invented SDK, and carries the
ASN/peer/VIP placeholder variables.
⚠️ Before the first VM row: a coordinator read must confirm the target bridge
is `bridge-vlan-aware` on the three TB4 nodes — that flag sits in the not-yet-
adopted NodeNetwork rows and has not been measured. If it is off, enabling it
is a node-network change that goes through the NodeNetwork lane, not this stack.

**Alternative (SDN VNets), and what changes:** the SDN chain lands on the Talos
path — SdnApply rebuilt with a member-node-changes refusal, fabric families
declared first, every apply a cluster-wide network reload; the VLAN read above
is replaced by VNet creates through the first-create gate; Cilium's BGP peers
move to SDN fabric addresses. O-A and O1 are unchanged either way.

## Risks

- ⛔ Digest pinning means two artifacts can drift (KV rewritten, PR not merged):
  failing closed is the design, but a stuck mismatch blocks every Talos deploy
  until the pair reconciles. Mitigation: the typed error names both digests.
- ⚠️ Everything talosctl is REASONED from v1.13 docs (`talos/resource.ts:15-16`);
  the first maintenance-mode apply is the first measurement. First apply runs
  `--dry-run` before the real one.
- ⚠️ A SIGKILL strands a 0600 temp config on the deploy host —
  `credentials.ts:112-113` accepts the same for the talosconfig; same argument.
- D2 = agent-lane read would put CA-carrying material within a compromised
  plan lane's reach; that is why D2 is a decision, not a default.

## Tim must decide

- **D1** Cluster name → mount name, and target-primary-only mount (recommended)
  vs interim vault + explicit migration copy-list entry.
- **D2** May the agent plan lane read the Talos mount (plans and verify need
  live digests), or do Talos plans run admin/operator-only? Recommended:
  admin-only until the k8s consumer path exists.
- **D3** Confirm O-A (all-in-vault, digest pinned in git) over O-B (template in
  git, render at reconcile).
- **D4** VLAN id + subnet for the Talos VLAN, and the BGP peer: UniFi,
  OPNsense, or both.
- **D5** vmid range for the Talos VMs (the gate plan's pre-create sweep covers
  10000–19999 — confirm that range is theirs).

## Acceptance tests

1. Kit unit (fake `bao` spawner): digest mismatch → typed error, no talosctl
   spawn, no temp file left behind. Match → argv is exactly
   `apply-config --file <tmp> --mode <m>`; temp file is 0600, created `wx`,
   gone after scope exit.
2. Kit structural: `MachineConfigProps` has no `configFile`; no talos prop,
   attribute or argv carries config bytes; state fixtures contain no PEM or
   token strings (grep gate in the family's tests).
3. O1: `bao policy read talos-provision` equals the repo join; with D2 = no,
   an agent-lane token is denied on the mount's `data/secrets`; the KV-v2
   mount exists where D1 placed it.
4. Stack: `plan:talos` against the empty cluster plans exactly the declared
   creates — zero adopts, zero updates; the first-create gate walkthrough is
   recorded per row before the deploy.
5. Coordinator (read-only): `bridge-vlan-aware` confirmed on the three TB4
   nodes before the first VM deploy.
6. Post-deploy: the provider's own read-back shows each node's live
   machineconfig digest equal to the pinned digest, and the verify pass reads
   every Talos row noop with zero refused-read warnings.
