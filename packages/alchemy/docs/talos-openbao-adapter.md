# `Kubernetes.ClusterAdapter` kind `talos-openbao`

Reads the cluster admin kubeconfig from OpenBao KV (`bao kv get`, in memory, nothing on disk)
when a `Kubernetes.Manifest` / `HelmChart` connects, and proves the answering cluster is the
pinned one by its kube-system `metadata.uid`. The persisted connection is `{ kind, uid }` only.
The design, the identity rule and the failure modes are in the header of
`src/talos/cluster-adapter.ts`; this page is what an operator must do differently.

## Connect deadline

Vault read and uid GET share one 10 s deadline. A hung `bao` or a silent apiserver fails closed
with `TalosOpenBaoConnectTimeout` (the `bao` child is killed with its process group). The HTTPS
GET itself cannot be cancelled: upstream `readObject` takes no abort signal, so the request may
linger until the OS gives up. That is an upstream ask, not something to re-implement here.

## Literal connections only

`talosOpenBaoConnection(uid)` throws `TalosUidNotLiteral` for an Output, and
`Talos.ClusterHealth` refuses an Output connection in `diff` for the same reason: `cluster: health`
passes that connection to workloads, and an unresolved connection hides a cluster change from the
plan.

## Usage rules

Upstream Alchemy behaviour the adapter cannot fix. Follow these or risk deleting objects on the
wrong cluster.

1. **Move a workload to another cluster only by new logical IDs** (destroy the old, create the new).
   Never change a live workload's `connection` in place: upstream skips the identity comparison
   when any input is unresolved (`HelmChart.ts:246`), so the old generation's cleanup can run
   against the new cluster.
2. **Manage namespaces as separate `Manifest`s**, never `HelmChart` `createNamespace`. A replacement
   cleanup deletes a shared `createNamespace` namespace (`HelmChart.ts:257`, `:344`) and everything
   else in it.
3. **Never rename a `HelmChart` `releaseName` in place.** It is replaced, and cleanup removes the
   release the new one just took over.

## Upstream asks (alchemy 2.0.0-beta.79)

- `HelmChart`/`Manifest` diff skips identity comparison when any input is unresolved.
- Replacement cleanup deletes a shared `createNamespace` namespace.
- `readObject` cannot be cancelled (`internal/client.ts:75`).
- `deleteObject` has no uid precondition.
- Refresh replaces the saved uids.
