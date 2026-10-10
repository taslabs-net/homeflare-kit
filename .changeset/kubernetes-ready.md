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
- A DaemonSet's `numberAvailable` also counts available old-template pods, so readiness requires
  `numberAvailable - (desired - updated) >= minReady`: a broken upgrade cannot pass on old pods. A
  non-`RollingUpdate` DaemonSet is `KubernetesRolloutFailed`.
- The poll covers connect: a 5xx, 429 or timeout on the identity GET is retried inside the
  deadline. `read` with no prior output adopts nothing. Only upstream's `Failed Kubernetes ...`
  errors count as transport; any other untagged error propagates. The timeout reports `states`
  per key (not found, or counts).
- Declaration refuses unsatisfiable `checks` (`KubernetesReadyBadCheck`) and an `after` that is
  not a lazy Output (`KubernetesReadyBadAfter`). A changed connection plans `replace`.
- The `talos-openbao` connection must be a literal uid, refused at declaration and in `diff`.
- The offline fake apiserver (`talos/fake-apiserver.ts`) gains an `objects` table.
