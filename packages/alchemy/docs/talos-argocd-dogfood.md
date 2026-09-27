# Talos + Argo CD dogfood — Distilled and Alchemy path

Status: decision record — fixes the per-vendor Distilled/Alchemy path for the
Talos + Argo CD dogfood stack; retire when the stack ships and each row is
proven live.
Verified: 2026-09-27 (LAND pass: CRD ownership, Talos K-A3, Cilium CNI
ordering, topology and the interim-package rule checked against merged PRs
262/295/307/311; see each section below).

Opened 2026-09-24 after
[PR 242](https://github.com/taslabs-net/homeflare-kit/pull/242) closed without
merge.

Placeholder stack: Talos Kubernetes on Proxmox VE, **Argo CD owns GitOps**.
This page is the Distilled / Alchemy path for each vendor — not a stack file,
and not a licence to invent SDKs.

## Why there are no interim packages

[distilled-interim.md](./distilled-interim.md) is generate+copy from a real
vendor schema (distilled clone Steps 1–8, then copy `src/` into
`packages/distilled-<vendor>`). ⛔ **`src/` is copied, never hand-written.**
A stub invented so a `@distilled.cloud/<vendor>` name can publish is the
failure #242 shipped: Alchemy would `catchTag` errors from a client nobody
can regenerate. ⛔ Do not add npm aliases for packages that do not exist.

## Per-vendor decision

| vendor    | decision                                                                                                                                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headlamp  | Skip Distilled / Alchemy vendor family — Argo Application / Helm                                                                                                                                                                                                                                        |
| Traefik   | No Distilled SDK (no official OpenAPI; do not invent)                                                                                                                                                                                                                                                   |
| Cilium    | No hand-written interim — install vehicle is D-S2 (open); CRDs via upstream Alchemy `Kubernetes.Manifest`                                                                                                                                                                                               |
| CNPG      | `postgresql.cnpg.io/v1` CRDs — upstream Alchemy `Kubernetes.Manifest` (S1), not `@distilled.cloud/kubernetes` (built-in API groups only)                                                                                                                                                                |
| Valkey    | operator CRDs — upstream Alchemy `Kubernetes.Manifest` (S1); Sentinel is RESP, not HTTP                                                                                                                                                                                                                 |
| Argo CD   | `Application`/`AppProject`/`ApplicationSet` — upstream Alchemy `Kubernetes.Manifest` (decision 49); `Repository`/`RepoCreds`/`Cluster` — `Argocd.Repository`/`RepoCreds`/`Cluster` (kit, built over `@distilled.cloud/argocd`, [PR 262](https://github.com/taslabs-net/homeflare-kit/pull/262), merged) |
| Talos CLI | No Distilled Talos SDK — stays on `talosctl`, reworked under K-A3 ([PR 307](https://github.com/taslabs-net/homeflare-kit/pull/307)/[311](https://github.com/taslabs-net/homeflare-kit/pull/311): `insecure` prop dropped, `Bootstrap.peers` added)                                                      |

Headlamp's `/config` and cluster proxy are not a vendor control plane.

Traefik declarative config is Kubernetes CRDs (`IngressRoute`, `Middleware`, …
— `traefik.io`, not a built-in group) / Helm values (experimental flags as
Helm props). CRDs go through upstream Alchemy `Kubernetes.Manifest` (S1), the
same as every other vendor's CRDs on this page, never
`@distilled.cloud/kubernetes`. The dashboard `GET /api/…` is read-only
runtime — optional later, not the dogfood install path.

Cilium's BGP and network-policy objects are genuine CRDs, not a built-in
Kubernetes API group, so they go through upstream Alchemy's
`Kubernetes.Manifest` (S1) — never `@distilled.cloud/kubernetes`: its 24
service files (checked at the kit's pin, `c2a78002`) cover only built-in
apiserver groups, and its `apiextensions` service defines CRD _schemas_, not
CRD _instances_. The install vehicle itself — inline manifests in the seeded
Talos machine config vs. a Helm step between `Kubeconfig` and `ClusterHealth`
— is **D-S2, still open**
([first-boot doc](https://github.com/taslabs-net/homeflare-kit/blob/main/docs/plans/2026-09-26-talos-stack-first-boot.md#tim-must-decide),
"Tim must decide"; inline manifests is the doc's recommendation, not yet
accepted). Either vehicle must set `cluster.network.cni.name: none` and
`cluster.proxy.disabled: true` (kube-proxy replacement) in the seeded config,
because Argo CD cannot install Cilium — Argo CD itself needs pod networking
first. Official swagger exists (`cilium/cilium` `api/v1/openapi.yaml`) but
the default transport is the unix socket `/var/run/cilium/cilium.sock`;
generate+copy a Distilled SDK later only if node-local agent health over
that socket is needed.

Argo CD's own storage — `Repository`, `RepoCreds` and `Cluster` — is a `Secret`
labeled with Argo CD's own convention, not a published Kubernetes API type, so
the kit's `Argocd.Repository`/`RepoCreds`/`Cluster` (built over
`@distilled.cloud/argocd`, already on npm) are the correct owner
([PR 262](https://github.com/taslabs-net/homeflare-kit/pull/262), merged). The
objects Argo CD reconciles — `Application`, `AppProject`, `ApplicationSet` —
are genuine `argoproj.io/v1alpha1` CRDs, so upstream Alchemy's
`Kubernetes.Manifest` owns those (decision 49, "upstream wins"), not a house
wrapper — see [argocd.md](./argocd.md) and
[argocd-kubernetes.md](./argocd-kubernetes.md). No Distilled Talos API in this
path.

## Gates

- ⛔ Do not publish an interim Distilled package until generate+copy from a
  real vendor schema ([distilled-interim.md](./distilled-interim.md) steps 1–2).
- ⛔ Do not invent a Traefik Distilled SDK without an official schema.
- `Argocd.Repository`/`RepoCreds`/`Cluster` were built ahead of a live
  Talos-on-PVE cluster ([PR 262](https://github.com/taslabs-net/homeflare-kit/pull/262),
  merged 2026-09-24; tested against `fake-argocd.ts`, a fake in-memory Argo CD
  API — the HTTP client and Distilled protocol underneath it are real, only
  the Argo CD server is faked; never exercised against a real instance) —
  Tim's build-ahead-of-need call. Declaring and applying
  `Application`/`AppProject`/`ApplicationSet` objects in a real stack still
  waits on that cluster existing.
- Prefer upstream Alchemy Kubernetes resources when they exist (S1).

## Placeholder variables

Names a consuming stack substitutes. Origins use RFC 2606 `*.example.com`.
Addresses use RFC 5737 documentation ranges. Secret _values_ never appear —
only env-var NAMES (S25). Nothing here is applied.

### Topology — 3 control plane, no workers today

`homeflare-proxmox`'s `src/talos-shape.ts` declares exactly 3 control-plane
VMs (`n2`/`n3`/`n4`, vmids 10000–10002) and no worker pool. The
`TALOS_WORKER_*` rows are placeholders for if/when a worker pool is added;
nothing consumes them yet.

| variable                              | placeholder                     |
| ------------------------------------- | ------------------------------- |
| `TALOS_CLUSTER_NAME`                  | `dogfood`                       |
| `TALOS_CP_NODES`                      | `cp-a`, `cp-b`, `cp-c`          |
| `TALOS_WORKER_NODES` (none today)     | `wk-a`, `wk-b`, `wk-c`          |
| `TALOS_CP_ADDRESSES`                  | `192.0.2.10/24` … `.12`         |
| `TALOS_WORKER_ADDRESSES` (none today) | `192.0.2.20/24` … `.22`         |
| `TALOS_CONTROL_PLANE_ENDPOINT`        | `https://k8s.example.com:6443`  |
| `TALOS_VERSION`                       | `v1.13.x` (never measured live) |
| `STORAGE_CLASS`                       | `STORAGE_CLASS`                 |
| `STORAGE_SIZE`                        | `STORAGE_SIZE`                  |

### Cilium BGP

| variable                  | placeholder       |
| ------------------------- | ----------------- |
| `CILIUM_BGP_CLUSTER_ASN`  | `64512` (private) |
| `CILIUM_BGP_PEER_ASN`     | `64513`           |
| `CILIUM_BGP_PEER_ADDRESS` | `198.51.100.1`    |
| `CILIUM_BGP_VIP_CIDR`     | `203.0.113.0/24`  |

### Traefik

| variable                     | placeholder                                     |
| ---------------------------- | ----------------------------------------------- |
| `TRAEFIK_ENTRYPOINTS`        | `web`, `websecure`                              |
| `TRAEFIK_EXPERIMENTAL_FLAGS` | Helm props, e.g. `kubernetesGateway`, `knative` |
| `TRAEFIK_NAMESPACE`          | `traefik`                                       |

### Installs Argo owns

| variable                    | placeholder                  |
| --------------------------- | ---------------------------- |
| `HEADLAMP_INGRESS_HOST`     | `headlamp.example.com`       |
| `CNPG_CLUSTER_NAME`         | `dogfood-pg`                 |
| `CNPG_INSTANCES`            | `3`                          |
| `CNPG_SUPERUSER_SECRET_ENV` | `CNPG_SUPERUSER_PASSWORD`    |
| `VALKEY_SENTINEL_NAME`      | `dogfood-valkey`             |
| `VALKEY_PASSWORD_ENV`       | `VALKEY_PASSWORD`            |
| `ARGOCD_SERVER`             | `https://argocd.example.com` |
| `ARGOCD_TOKEN_ENV`          | `ARGOCD_TOKEN`               |

## Non-goals

- No Flux. Argo CD is the GitOps controller.
- No new Distilled Talos SDK from this page — `@homeflare/alchemy/talos`
  already reworked under K-A3 ([PR 307](https://github.com/taslabs-net/homeflare-kit/pull/307),
  [PR 311](https://github.com/taslabs-net/homeflare-kit/pull/311)); it stays on
  `talosctl`.
- No new Alchemy provider code from this page itself — `Argocd.*` (PR 262)
  and upstream `Kubernetes.Manifest` already cover this stack's objects.
  Declaring and applying them against a real cluster still waits on
  Talos-on-PVE existing (see Gates).
- No `packages/distilled-traefik`, `packages/distilled-cilium`, or other
  interim Distilled packages for this stack.
