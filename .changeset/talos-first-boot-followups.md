---
'@homeflare/alchemy': minor
---

Closes the three `Talos.*` follow-ups PR 307 named but did not fix
(docs/plans/2026-09-26-talos-stack-first-boot.md), and exports their Resource constructors now
that the fixes land:

`Talos.Bootstrap` — "once means once". The shipped `isBootstrapped` turned every read failure into
`false` (`Effect.orElseSucceed`), so `reconcile` could re-run `talosctl bootstrap` against an
already-bootstrapped cluster after a merely transient read failure — Talos's only server-side guard
is a non-empty etcd data directory, so this forms a second, isolated single-member cluster (split
brain) rather than rejoining the existing one. Fixed: `read` now answers presence/absence correctly
(`undefined` only from a successful read that finds no members; a failing read propagates instead of
being read as absence); `diff` trusts `output.bootstrapped` once it is `true` and never touches the
live cluster; `reconcile` checks `output?.bootstrapped` first and, once true, never spawns `talosctl
bootstrap` again — a failing or empty confirmation read both raise the new `TalosReBootstrapRefused`
instead. Re-bootstrap is now a human decision, never an automatic one.

`Talos.ClusterHealth` — no more swallowed transport errors. The shipped `read` caught EVERY error
from its health check, including a `mintTalosconfig`/`bao` failure, into a plain `healthy: false` —
a vault outage read exactly like "cluster not healthy yet". `read` and `reconcile` now only catch
`TalosError` (a completed `talosctl health` run that itself exited non-zero); anything else
propagates. The type's own doc comments also now say explicitly that a consuming stack's `after`
must reach past `Talos.Bootstrap`/`Talos.Kubeconfig` through the Cilium CNI install — the default
health checks (kube-proxy, CoreDNS) wait on a CNI that does not exist yet at bootstrap.

`Talos.Kubeconfig` — lands in OpenBao instead of an un-vaulted host `runtimePath` that was never
cleaned up. CREATE now runs `talosctl kubeconfig` into a throwaway unguessable temp path, reads it
back, and writes its bytes into the vault via stdin (`credentials-write.ts`'s new `writeKvValue` —
never argv), then deletes the temp file. Written ONCE at bring-up, not re-minted every deploy (a
fresh admin cert every reconcile would rotate credentials for no reason): once `output` is defined,
reconcile only reads the vault copy back to confirm it. The `runtimePath` prop is gone, replaced by
an optional `kubeconfigKey` (default `'kubeconfig'`); the persisted `connection` no longer carries a
host path — a consumer materializes its own temp file via the new `mintKubeconfig` (the same pattern
`mintTalosconfig` already established for the talosconfig itself). Wiring `Kubernetes.ClusterAdapter`
to call it is separate, later work.

`TalosBootstrap`, `TalosClusterHealth` and `TalosKubeconfig` (plus their `*Attributes`/`*Props` types)
now export from the package barrel alongside their `*Provider` factories, so a consuming stack can
actually declare these rows — PR 307's red team held them back specifically for the defects above.

Docs: `docs/plans/2026-09-26-talos-secrets-flow.md` records Tim's D1/D2/D3 answers (decision 61 —
mini's vault + copy-list entry, agent plan lane denied, O-A all-in-vault-digest-pinned confirmed) and
`docs/plans/2026-09-26-ceph-mon-transport.md` records decision 65's `auth get` amendment (read
directly, in-process, on every reconcile — no node-side shell filter for that call — key dropped
before anything is logged/returned/stored).

**LAND red team fixes, applied before merge (same PR, never shipped broken):**

- `Talos.Kubeconfig` could never actually be created — `read` returned a defined, empty-fingerprint
  object instead of `undefined` on a genuine cold start, so the engine always adopted it and forced
  `update`, and `reconcile`'s write-once gate then tried to confirm a key that had never been
  written. Fixed: `read` now distinguishes a measured OpenBao "key never written" response from
  every other failure; `reconcile`'s write-once branch also gates on a non-empty
  `credentialGeneration`, not just a defined `output`.
- `credentials-write.ts`'s `writeKvValue` used `field=@-`, which is not the stdin convention (`@`
  means "read a file at this literal path") — measured against OpenBao v2.6.2, it fails outright, or
  silently reads a stray file literally named `-`. Fixed to `field=-`.
- `Talos.ClusterHealth` could never pass with more than one control-plane node — `--nodes` took the
  full node list, and `talosctl health` refuses more than one. Fixed: one contact node for
  `--nodes`/`--endpoints`; the full lists still reach `--control-plane-nodes`/`--worker-nodes`.
- The persisted `connection`'s `auth.path` was left `undefined`, which would let a consumer's stock
  `Kubernetes.KubeConfigAdapter` silently fall back to `$KUBECONFIG`/`~/.kube/config` instead of
  failing — exactly the exposure this feature removes elsewhere. Fixed to a sentinel path that can
  never resolve, so an early consumer fails loudly instead of reaching a stranger's cluster.
- `Talos.Bootstrap` gained an optional `peers` prop: before a CREATE bootstraps a node, every listed
  peer must show a successful, empty etcd-members read, closing a split-brain path where a lost
  state row plus a reset node would otherwise re-bootstrap a second cluster.
