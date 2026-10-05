# Talos stack and first boot — alchemy.talos.ts, apply lifecycle, bootstrap

Ledger row: talos-k8s

Status: active — design gate for K-A3 (Talos resource rework), stack and
lifecycle half; retires together with the secrets-flow doc
Verified: 2026-09-26 (red-team findings applied same date)

Part of the design suite gating Talos-on-PVE work. Companions:
[secrets flow](./2026-09-26-talos-secrets-flow.md) ·
[networking](./2026-09-26-talos-networking.md) ·
[Ceph transport](./2026-09-26-ceph-mon-transport.md).
⛔ This repo is public: no hostnames, addresses or secret values appear here.

## The separate stack — alchemy.talos.ts

- Lives in homeflare-proxmox beside `alchemy.node.ts` (its `docs/stacks.md`:
  one stack per system). Own stack name, own rows in the shared state store,
  `plan:talos` / `deploy:talos`; deploys are operator-run on the admin lane —
  and with the secrets doc's D2 recommendation (agent lane denied on the Talos
  mount), plans and verify run on the admin lane too.
- PVE credential: minted from the TB4 engine role bound to the new
  `TalosProvisioner` role/user (K-A0 — Tim: separate TB4-only role, least
  privilege; the old apply token joins the retire list).
- Rows, all creates through the first-create gate, no `adopt()`:
  `Proxmox.StorageDownload` (checksum-pinned Talos image, K-A2, after the
  storage-content `import` update), `Proxmox.Vm` ×N node-pinned with HA off
  (kit `qemu-read` fails a plan whose vmid moved nodes — a migration is not an
  update), then per node `Talos.MachineConfig` (secrets-doc O-A props,
  `after:` its VM row), `Talos.Bootstrap` once, `Talos.Kubeconfig`, the CNI
  step, and the health gate **last** — the order the CNI section below forces.
- ⛔ No VM prop carries machine config bytes or `cipassword` (K-A1 rule).

## First apply — maintenance mode is a lifecycle, not a prop

- A fresh VM boots the Talos installer into maintenance mode: no talosconfig
  auth exists yet, so the **first** apply must run `--insecure`, and every
  later apply authenticates with the minted talosconfig. A fixed `insecure`
  prop fails in both directions — `true` breaks updates to a configured node,
  `false` breaks the create — so K-A3 drops the prop entirely: the CREATE path
  applies `--insecure`, the UPDATE path never does. REASONED from Talos v1.13
  docs; the first live create is the measurement.
- ⛔ NO `--dry-run` ON THE FIRST APPLY. Talos's dry-run returns a full,
  unredacted text diff of old and new config (REASONED from Talos source:
  `internal/app/machined/pkg/runtime/v1alpha1_server.go:258-272` +
  `configdiff.go`), and `talosctl` prints it. With an empty old config that
  diff **is** the whole config — CA private keys, bootstrap token, secretbox
  key — straight into the terminal and the transcript. If a dry-run is ever
  wanted, discard stdout and keep only the exit status; recommended: don't —
  the digest read-back below is the check.

## Converged — what the digest read-back can and cannot say

- ⛔ THE SHIPPED READ-BACK CAN NEVER REPORT CONVERGED.
  `talosctl get machineconfig -o yaml` wraps the document — a `node:` line,
  resource metadata with version and timestamps, then the config as a raw
  YAML string under `spec` (REASONED from talosctl source,
  `cmd/talosctl/.../output/yaml.go:63`,
  `resources/config/machine_config.go:40-50`) — and
  `talos-machine-config.ts:70-76` hashes that whole wrapper, which never
  equals the pinned digest. Consequences, all confirmed against the shipped
  code: reconcile dies after every successful apply (`:115-121`), diff always
  plans `update`, verify is never all-noop.
- K-A3: hash the **extracted `spec` payload** only, and poll the read-back in
  short intervals with a bounded cap (never one long sleep — house timeout
  rule), because reboot modes drop the Talos API mid-apply.
- `converged` per mode: `no-reboot`/`try` → the immediate read-back equals the
  pin. `reboot`, `staged`, and the first install (`auto` when a reboot is
  needed) → the apply was accepted, and convergence is proven by the bounded
  poll after the node returns; if the cap expires, the row fails with a typed
  error naming the mode — never a silent pass. State records which claim was
  made (`converged: 'read-back' | 'accepted'`).

## Bootstrap — once means once

- ⛔ `Talos.Bootstrap` AS SHIPPED CAN BOOTSTRAP A SECOND etcd CLUSTER.
  `isBootstrapped` turns every read failure into `false`
  (`talos-bootstrap.ts:48-55`, `orElseSucceed`), diff then plans `update`, and
  reconcile re-runs `talosctl bootstrap`. Talos's only server-side guard is a
  non-empty etcd data directory (REASONED, `v1alpha1_server.go:441`) — so a
  reinstalled or reset bootstrap node (say, after a VM replace) re-bootstraps
  a fresh single-member etcd cluster: split brain.
- K-A3: once state records `bootstrapped: true`, bootstrap **never runs
  again** — diff reports noop WITHOUT touching the live cluster (Alchemy never
  reconciles a `noop` node — LAND red team I3, verified against `Apply.ts`),
  and a not-bootstrapped or failing read AGAINST BOOTSTRAPPED STATE is a typed
  error that refuses and hands the node to the operator. That confirm-and-refuse
  branch runs from reconcile, so it only executes on `--force` or a genuine
  `update`/`create` node — an ordinary `plan`/`deploy` never reaches it once a
  node is noop, so a reset control-plane node (etcd wiped, VM replaced) is
  invisible to plan/deploy alike until an operator runs `--force` or a verify
  pass. Re-bootstrap is a human decision, not a reconcile; this gap is open
  work, not a regression this doc's original text hid on purpose.
- ⛔ No swallowing reads anywhere in the Talos family: a failed read
  propagates as its typed transport error (`catchTag` on the named tags,
  distilled doctrine — the shipped `orElseSucceed` shapes are removed).
  Absence may only ever be concluded from a **successful** read.
- ⛔ LAND red team I4 — a **lost state row** (wrong `--stage`, a wiped state
  store) plus a genuinely reset node is a second split-brain path the "once
  means once" fix above doesn't close by itself: the cold-start adoption read
  on the reset node comes back empty, so plan calls `create`, and bootstrap
  would run there too even though the cluster already lives on the other
  control-plane nodes. `BootstrapProps.peers` closes it: the CREATE path now
  requires every listed peer to show a successful, EMPTY etcd-members read
  before it will bootstrap. Optional (a single-control-plane declaration keeps
  working unguarded), but the 3-node stack this doc describes SHOULD set it.

## CNI ordering — Cilium cannot install itself

- The dogfood decision record (kit PR 253, open as of 2026-09-26;
  `packages/alchemy/docs/talos-argocd-dogfood.md` once merged) fixes Cilium as
  Helm + CRDs with kube-proxy replacement. That means the seeded machine
  config (the secrets doc's one-time operator step) must already carry
  `cluster.network.cni.name: none`, `cluster.proxy.disabled: true` and the
  talosconfig endpoints — the seed checklist names all three.
- ⛔ `talosctl health` FAILS UNTIL A CNI RUNS — its default suite checks nodes
  Ready, kube-proxy and CoreDNS, and Talos's own comment says these wait on
  the CNI (REASONED, `pkg/cluster/check/default.go:28-60,89-91`). And Argo CD
  cannot install Cilium, because Argo CD itself needs pod networking. So the
  draft's row order (health gate directly after bootstrap) deadlocks into its
  timeout on every first deploy.
- K-A3 order: `Bootstrap` → `Kubeconfig` → Cilium install → `ClusterHealth`.
  Cilium install vehicle is D-S2: **inline manifests in the seeded config
  (recommended** — digest-pinned like everything else, zero extra moving
  parts) vs a Helm step between Kubeconfig and the health row. Either way,
  any health check that runs before Cilium is narrowed to what can pass
  without a CNI (etcd members, apid reachability).

## Tim must decide

- **D-S1** vmid range for the Talos VMs — confirm 10000–19999, the range the
  gate plan's pre-create sweep (G8) already covers.
- **D-S2** Cilium install vehicle: inline manifests in the seeded config
  (recommended) vs a Helm step in the stack between Kubeconfig and health.

## Acceptance tests

1. Stack: `plan:talos` against the empty cluster plans exactly the declared
   creates — zero adopts, zero updates; the first-create gate walkthrough is
   recorded per row before the deploy.
2. Kit unit (fake talosctl): the create path spawns `apply-config` with
   `--insecure`; the update path never passes it; no argv ever carries
   `--dry-run`.
3. Kit unit: the read-back hashes the extracted `spec` only — a fixture
   wrapper with differing metadata still converges; a transport failure
   propagates as the typed error, never as `converged: false`.
4. Bootstrap: with state `bootstrapped: true` and a failing or empty read, the
   fake runner proves `talosctl bootstrap` is never spawned again and the row
   surfaces the operator-handoff error.
5. Post-deploy (operator): each node's live machineconfig **spec** digest
   equals the pinned digest, and the verify pass reads every Talos row noop
   with zero refused-read warnings.
