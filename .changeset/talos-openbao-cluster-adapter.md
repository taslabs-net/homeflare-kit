---
'@homeflare/alchemy': minor
---

Add Kubernetes cluster auth kind `talos-openbao`. Connect reads the admin kubeconfig from
OpenBao KV with `bao` (BAO_ADDR and BAO_TOKEN required, minimal child env) and returns a
ClusterTransport; the persisted connection is `{ kind, cluster }` only. mount, key and context
are `TalosOpenBaoAdapter({ <cluster>: { mount, key, context, retired? } })` configuration keyed
by cluster (build each entry with `talosOpenBaoCluster(kubeconfigProps)` so the writer and the
reader share one source), so renaming them can never make upstream replace workloads. A
connection naming an unconfigured cluster fails with `TalosOpenBaoUnknownCluster`. A missing
vault key is `TalosVaultKeyMissing`, and `ClusterNotFoundError` only for a cluster marked
`retired: true`.
`HF_TALOSCTL` must be absolute, not a symlink, owned by the user or root, not group/world-writable
(nor its directory), and report exactly v1.14.2; talosctl runs with a minimal env (no BAO_TOKEN).
`Talos.Kubeconfig.connection` now uses that kind.
`Talos.ClusterHealth.connection` is required and copied onto attributes so the resource is
ClusterLike. `HF_TALOSCTL` or `TalosRunOptions.binary` selects the talosctl executable.

An unreadable document fails with `TalosKubeconfigUnreadable` and does not echo the document.

Walked against alchemy 2.0.0-beta.79 `Kubernetes/Connection.ts`, `ClusterAdapter.ts` and
`internal/client.ts` (CA stays base64, client cert is PEM). OpenBao absence text is the
v2.6.2 `No value found at` string already recorded on `isVaultKeyAbsent`. Talos kubeconfig
shape is the v1.13 document `values.ts` parses; the binary override is how a lane pins
v1.14.2. Tests use a fake `bao`/`talosctl`. No live vault and no live cluster.
