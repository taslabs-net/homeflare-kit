# HomeFlare.Kubernetes.Ready

`@homeflare/alchemy/kubernetes` — a readiness gate for a Kubernetes cluster reached through the
`talos-openbao` adapter. Walked against `alchemy@2.0.0-beta.81`. Proven offline only (fake `bao`,
fake apiserver); **not** exercised against a live cluster.

## Why it exists

Upstream ships no readiness resource. `Kubernetes.HelmChart` reconcile returns when server-side
apply returns, and Alchemy releases every downstream row at that moment. A row chained after the
Cilium chart would start before one Cilium pod runs. Declare a `Ready` row with
`after: [chart.objects]` and chain later rows on `ready.ready`.

## Declaring it

```ts
const cniReady =
  yield *
  KubernetesReady('cni-ready', {
    connection: talosOpenBaoConnection(PINNED_UID), // a literal uid, never an Output
    checks: [
      { kind: 'DaemonSet', namespace: 'kube-system', name: 'cilium', minReady: 2 },
      { kind: 'Deployment', namespace: 'kube-system', name: 'cilium-operator' },
      { kind: 'CustomResourceDefinition', name: 'ciliumloadbalancerippools.cilium.io' },
    ],
    waitTimeout: '10m0s', // Go style h/m/s, default 10m0s
    pollInterval: '10s', // default 10s
    after: [cilium.objects],
  });
```

Providers: `Layer.mergeAll(Kubernetes.providers(), TalosOpenBaoAdapter(...), KubernetesReadyProvider())`.
The provider requires `ChildProcessSpawner` (the adapter shells to `bao`).

## What "ready" means

The rules are `kubectl rollout status` (kubectl v0.34.0 `rollout_status.go`), not "Available":

| kind                     | ready when                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| DaemonSet                | `observedGeneration >= generation`, `updatedNumberScheduled >= minReady`, `numberAvailable >= minReady`                                       |
| Deployment               | `observedGeneration >= generation`, `updatedReplicas == spec.replicas`, `replicas == updatedReplicas`, `availableReplicas >= updatedReplicas` |
| CustomResourceDefinition | condition `Established` is `True`                                                                                                             |

`minReady` defaults to `desiredNumberScheduled`, and a DaemonSet that wants zero pods is never ready.
A Deployment whose `Progressing` condition has reason `ProgressDeadlineExceeded` (for the
generation the controller has observed) is a typed failure, `KubernetesRolloutFailed`, not pending.

## Errors

| outcome                                                        | `read` / `diff` (one pass) | `reconcile` (poll)                                  |
| -------------------------------------------------------------- | -------------------------- | --------------------------------------------------- |
| 404 (`_tag` `KubernetesNotFound`, or `KubernetesApiError` 404) | pending                    | pending                                             |
| per-GET timeout (5 s), 5xx, 429, transport `Error`             | propagates                 | pending, recorded as `lastTransient` (tag + status) |
| 401, 403, other 4xx                                            | propagates                 | propagates                                          |
| connect, uid mismatch, vault (`bao`) failure                   | propagates                 | propagates                                          |

- 404 is matched by tag string with no import, so it is proof against alchemy raising
  `KubernetesNotFound` instead of `KubernetesApiError` (standing watch: drop the second shape once
  upstream settles).
- A deadline fails with `KubernetesReadyTimeout { failing, seconds, lastTransient? }`. `failing`
  holds **check keys** (`DaemonSet/kube-system/cilium`) only.
- A propagated apiserver refusal is rewrapped as `KubernetesReadyApiError { method, path,
statusCode }`: upstream's `KubernetesApiError` message quotes up to 1000 bytes of the response
  body, which this row does not republish.
- Upstream `readObject` takes no signal, so a timed-out GET abandons its socket rather than
  aborting it; the process exit reaps it. Upstream also retries a transport error for 5 s, which
  equals the per-GET bound, so a dead socket usually surfaces as the GET timeout.

## Lifecycle

- `read`: one pass, `ready: false` when any check is pending. Never waits.
- `diff`: refuses a non-literal `connection` (`TalosUidNotLiteral`, also at declaration);
  `undefined` when unresolved; `noop` when the live pass is ready and the connection and check
  keys are unchanged; otherwise `update`. It is live on every plan, like `Talos.ClusterHealth`.
- `reconcile`: polls until every check passes or fails typed.
- `delete` is a no-op and `list` is empty: the row owns nothing in the cluster. `connection` is
  `stables`, and is copied onto the attributes so the row is `ClusterLike`.

## Secrecy

Attributes are `{ connection, ready, checks }`; the connection is `{ kind, uid }`. No kubeconfig,
PEM, token or response body reaches an attribute, an error, a log or a file
(`ready-secrecy.test.ts`).
