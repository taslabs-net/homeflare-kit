---
'@homeflare/alchemy': minor
---

Add Kubernetes cluster auth kind `talos-openbao`. Connect reads the admin kubeconfig from
OpenBao KV with `bao` (BAO_ADDR and BAO_TOKEN required, minimal child env) and returns a
ClusterTransport; the persisted connection is `{ kind, uid }` only, where `uid` is the physical
cluster's kube-system uid. mount, key, context and uid are
`TalosOpenBaoAdapter({ <alias>: { mount, key, context, uid, retired? } })` configuration (build each
entry with `talosOpenBaoCluster(kubeconfigProps, { uid })` so the writer and the reader share one
source). Connect looks the entry up BY uid and proves the answering cluster has that uid before
returning a transport, so renaming an alias, vault key, mount or context can never make upstream
replace workloads. A uid no entry is pinned to fails with `TalosOpenBaoUnknownCluster`, two entries
pinned to one uid with `TalosOpenBaoAmbiguousUid`, and a saved row that still carries the old
`auth.cluster` alias with `TalosOpenBaoLegacyAuth` (edit the saved state once; there is no silent
migration). A missing vault key is `TalosVaultKeyMissing`; an entry marked `retired: true` answers
`ClusterNotFoundError` without a vault read.
`Talos.ClusterIdentity` refuses a changed uid (`TalosClusterMoved`) in diff, read and reconcile
(so `alchemy drift --repair` cannot launder a move) instead of updating, and publishes `{ uid }`
only. The connection uid is a LITERAL (`talosOpenBaoConnection` throws `TalosUidNotLiteral` for an
Output): an unresolved uid plans an update and replays the old cluster's deletes on the new one.
Bootstrap-then-pin: the first deploy creates the cluster and `Talos.ClusterIdentity` with no
workloads, the operator pins the printed uid in `TalosOpenBaoAdapter`, workloads deploy after. The
uid read times out after 10 s with `TalosClusterIdentityTimeout`.
`HF_TALOSCTL` must be absolute, not a symlink, owned by the user or root, not group/world-writable
(nor its directory), and report exactly v1.14.2; talosctl runs with a minimal env (no BAO_TOKEN).
`Talos.Kubeconfig.connection` now uses that kind.
`Talos.ClusterHealth.connection` is required and copied onto attributes so the resource is
ClusterLike. `HF_TALOSCTL` or `TalosRunOptions.binary` selects the talosctl executable.

Connect (and `Talos.ClusterIdentity`) run under one 10 s deadline covering the vault read and the
uid GET: a hung `bao` fails with `TalosOpenBaoConnectTimeout` and its child is killed.
`Talos.ClusterHealth` refuses an Output connection in `diff` (`TalosUidNotLiteral`).
Usage rules for upstream behaviour: packages/alchemy/docs/talos-openbao-adapter.md.

An unreadable document fails with `TalosKubeconfigUnreadable` and does not echo the document.

Walked against alchemy 2.0.0-beta.79 `Kubernetes/Connection.ts`, `ClusterAdapter.ts` and
`internal/client.ts` (CA stays base64, client cert is PEM). OpenBao absence text is the
v2.6.2 `No value found at` string already recorded on `isVaultKeyAbsent`. Talos kubeconfig
shape is the v1.13 document `values.ts` parses; the binary override is how a lane pins
v1.14.2. Tests use a fake `bao`/`talosctl`. No live vault and no live cluster.
