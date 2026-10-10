---
'@homeflare/alchemy': minor
---

Add `boundedHelmChartProvider` to `@homeflare/alchemy/kubernetes` (ledger row `t10-k1b`). Upstream's
`Kubernetes.HelmChart` sets no timeout and no signal on any apiserver request (alchemy
2.0.0-beta.81), so a hung apiserver blocks reconcile and read forever. The layer wraps upstream's
provider in a wall-clock deadline (`HELM_RECONCILE_TIMEOUT` 5m0s, `HELM_READ_TIMEOUT` 1m0s) and
fails typed `KubernetesReconcileTimeout`. Register it as a direct `Provider(HelmChart)` beside
`Kubernetes.providers()`; `diff`, `delete`, `stables` and `aliases` stay upstream's. Walked against
alchemy@2.0.0-beta.81; proven only against a fake apiserver.
