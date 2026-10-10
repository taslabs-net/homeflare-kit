---
'@homeflare/alchemy': minor
---

Add `HomeFlare.Kubernetes.Ready` and a new `@homeflare/alchemy/kubernetes` subpath (ledger row
`t10-k1`). A readiness gate for a cluster reached through `talos-openbao`: upstream's
`Kubernetes.HelmChart` releases downstream rows when server-side apply returns, so nothing waits
for a CNI to run. Walked against alchemy@2.0.0-beta.81; proven only against a fake apiserver.

- Readiness follows `kubectl rollout status`: `observedGeneration >= generation` first, then the
  updated and available counts (DaemonSet `minReady`, Deployment `updatedReplicas == spec.replicas`).
  `ProgressDeadlineExceeded` is a typed failure (`KubernetesRolloutFailed`); a CRD is ready when
  `Established`.
- 404 is pending whether alchemy raises `KubernetesApiError` 404 or `KubernetesNotFound`. Inside
  `reconcile` a per-GET timeout, 5xx, 429 or a transport error is pending and named as
  `lastTransient` in `KubernetesReadyTimeout`; `read` propagates them. 401/403, uid mismatch and
  vault failures propagate everywhere, as `KubernetesReadyApiError` (the response body is dropped).
- The `talos-openbao` connection must be a literal uid, refused at declaration and in `diff`.
- The offline fake apiserver (`talos/fake-apiserver.ts`) gains an `objects` table.
