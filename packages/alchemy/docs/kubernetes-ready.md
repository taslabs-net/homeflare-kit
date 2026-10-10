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

| kind                     | ready when                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DaemonSet                | `updateStrategy` is `RollingUpdate`, `observedGeneration >= generation`, `updatedNumberScheduled >= minReady`, `numberAvailable - (desiredNumberScheduled - updatedNumberScheduled) >= minReady` |
| Deployment               | `observedGeneration >= generation`, `updatedReplicas >= spec.replicas`, `replicas == updatedReplicas`, `availableReplicas >= updatedReplicas`                                                    |
| CustomResourceDefinition | condition `Established` is `True`                                                                                                                                                                |

`minReady` defaults to `desiredNumberScheduled`, and a DaemonSet that wants zero pods is never ready.
`numberAvailable` also counts available pods of the OLD template, so it is never compared to
`minReady` alone: subtracting `desired - updated` (the most old pods there can be) leaves a lower
bound on pods that are both updated and available. Without it, minReady 2 of 4 with two crashlooping
new pods and two healthy old ones would pass.
A Deployment whose `Progressing` condition has reason `ProgressDeadlineExceeded` (for the
generation the controller has observed), and a DaemonSet whose `updateStrategy` is not
`RollingUpdate` (absent counts as `RollingUpdate`), are typed failures, `KubernetesRolloutFailed`
(`reason`), not pending.

## Refused at declaration

- `checks` must be non-empty; each needs a known `kind`, a non-empty `name`, a non-empty
  `namespace` for DaemonSet and Deployment, and `minReady` (DaemonSet only) an integer >= 1:
  `KubernetesReadyBadCheck { index, problem }`.
- `after` must hold lazy Outputs of the chart (`chart.objects`): `KubernetesReadyBadAfter { index }`
  for a plain value, a bare `chart`, or a stable such as `chart.connection`. Those resolve at plan
  time, so the row would plan `noop` before the chart's update and the gate would be skipped.

## Errors

| outcome                                                        | `read` / `diff` (one pass) | `reconcile` (poll)                                        |
| -------------------------------------------------------------- | -------------------------- | --------------------------------------------------------- |
| 404 (`_tag` `KubernetesNotFound`, or `KubernetesApiError` 404) | pending                    | pending                                                   |
| per-GET timeout (5 s), 5xx, 429, upstream transport `Error`    | read: throws; diff: update | pending, recorded as `lastTransient` (tag + status)       |
| the same on the connect's identity GET (incl. its 5 s timeout) | propagates                 | connect retried every `pollInterval`, inside the deadline |
| 401, 403, other 4xx                                            | propagates                 | propagates                                                |
| uid mismatch, vault (`bao`) failure                            | propagates                 | propagates                                                |
| any other untagged `Error` (a defect, e.g. an empty namespace) | propagates                 | propagates                                                |

- "Upstream transport `Error`" is only the `Failed Kubernetes ...` wrapper (alchemy `client.ts`).
- `lastTransient` is the transient of the LAST pass; one that has cleared is not blamed.
- `read` with no prior output (Alchemy's deferred adoption read on a first create) returns
  `undefined` without touching the cluster: the row owns nothing to adopt.
- Every error leaving a GET, the connect's identity GET included, is scrubbed of the response body.

- 404 is matched by tag string with no import, so it is proof against alchemy raising
  `KubernetesNotFound` instead of `KubernetesApiError` (standing watch: drop the second shape once
  upstream settles).
- A deadline fails with `KubernetesReadyTimeout { failing, seconds, lastTransient?, states? }`.
  `failing` holds **check keys** (`DaemonSet/kube-system/cilium`) only; `states` records per key
  what the last pass saw: `{ notFound: true }` (a 404 that never resolves) or `{ counts }`
  (generation and rollout numbers), so a missing object reads differently from a slow rollout.
- A propagated apiserver refusal is rewrapped as `KubernetesReadyApiError { method, path,
statusCode }`: upstream's `KubernetesApiError` message quotes up to 1000 bytes of the response
  body, which this row does not republish.
- Upstream `readObject` takes no signal, so a timed-out GET abandons its socket rather than
  aborting it, and process exit is not a bound for a long apply. The poll therefore rations
  timeouts: after one GET times out the rest of that pass is pending with no GET, and the pause
  doubles per consecutive timeout (cap 30 s), resetting on a clean pass. Standing watch: drop this
  when upstream's `readObject` takes an AbortSignal (alchemy PR 1948, per-attempt deadlines).
- Upstream also retries a transport error itself, for about 40 s (a `spaced` 5 s schedule capped
  by `recurs(8)`), longer than the per-GET bound, so a dead socket surfaces as the GET timeout.

## Lifecycle

- `read`: one pass, `ready: false` when any check is pending. Never waits.
- `diff`: refuses a non-literal `connection` (`TalosUidNotLiteral`, also at declaration);
  `undefined` when unresolved; `replace` when the connection differs (it is in `stables`, so
  dependants would otherwise see the old one for a deploy; `delete` is a no-op, so nothing live
  is touched); `noop` when the live pass is ready and the check keys are unchanged; otherwise
  `update`. It is live on every plan, like `Talos.ClusterHealth`, but a transient (5xx, 429, a
  timeout, on the connect or a GET) is `update`, never a failed plan: `reconcile` does the
  waiting. 401/403 and vault failures still propagate.
- `reconcile`: polls until every check passes or fails typed.
- `delete` is a no-op and `list` is empty: the row owns nothing in the cluster. `connection` is
  `stables`, and is copied onto the attributes so the row is `ClusterLike`.

## Secrecy

Attributes are `{ connection, ready, checks }`; the connection is `{ kind, uid }`. No kubeconfig,
PEM, token or response body reaches an attribute, an error, a log or a file
(`ready-secrecy.test.ts`).

## Bounded HelmChart (`boundedHelmChartProvider`, ledger row `t10-k1b`)

Upstream's `Kubernetes.HelmChart` has no deadline: alchemy 2.0.0-beta.81's `requestJson` sets no
timeout and no signal, so a hung apiserver blocks `reconcile`/`read` forever and would hold a 1h
platform token across a stuck deploy. `boundedHelmChartProvider()` wraps upstream's provider (never
re-implements it) in `Effect.timeoutOrElse`, failing typed `KubernetesReconcileTimeout { id,
operation, seconds }`: `HELM_RECONCILE_TIMEOUT = '5m0s'` (render, discovery, ~60 SSA PATCHes) and
`HELM_READ_TIMEOUT = '1m0s'`.

- Merge it beside `Kubernetes.providers()`: `Layer.mergeAll(Kubernetes.providers(),
boundedHelmChartProvider())`. A direct `Provider(HelmChart)` service beats the collection
  (`Provider.ts` `tryFindProviderRegistrationByType`), so the wrapper is the one the engine resolves.
- `diff`, `delete`, `stables` and `aliases` are upstream's by spread: state identity and replace
  semantics do not change.
- The interrupted fiber abandons its socket (upstream takes no signal); the run fails typed and the
  process exits once main completes. Standing watch: drop the wrapper when upstream ships request
  deadlines (alchemy PR 1948).
- A malformed override dies at layer build rather than leaving the call unbounded. The error
  message names the row and seconds only.
