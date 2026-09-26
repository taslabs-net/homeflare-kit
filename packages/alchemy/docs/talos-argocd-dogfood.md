# Talos + Argo CD dogfood — Distilled and Alchemy path

Status: decision record. Written 2026-09-24 after
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

| vendor    | decision                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| Headlamp  | Skip Distilled / Alchemy vendor family — Argo Application / Helm                                                           |
| Traefik   | No Distilled SDK (no official OpenAPI; do not invent)                                                                      |
| Cilium    | No hand-written interim — Helm + CRDs                                                                                      |
| CNPG      | `@distilled.cloud/kubernetes` CRDs (`postgresql.cnpg.io/v1`)                                                               |
| Valkey    | `@distilled.cloud/kubernetes` (operator CRDs); Sentinel is RESP, not HTTP                                                  |
| Argo CD   | `@distilled.cloud/argocd` — [PR 240](https://github.com/taslabs-net/homeflare-kit/pull/240) stays draft until Talos-on-PVE |
| Talos CLI | Leave `@homeflare/alchemy/talos` alone (`talosctl`)                                                                        |

Headlamp's `/config` and cluster proxy are not a vendor control plane.

Traefik declarative config is Kubernetes CRDs / Helm values (experimental flags as
Helm props). Prefer `@distilled.cloud/kubernetes` and upstream Alchemy Kubernetes
resources (S1). The dashboard `GET /api/…` is read-only runtime — optional later,
not the dogfood install path.

Cilium install, BGP and policy go through Helm + CRDs (`@distilled.cloud/kubernetes`
/ Alchemy Kubernetes). Official swagger exists (`cilium/cilium` `api/v1/openapi.yaml`)
but the default transport is the unix socket `/var/run/cilium/cilium.sock`.
Generate+copy later only if node-local agent health is needed.

Argo CD's package is already on npm. No Distilled Talos API in this path.

## Gates

- ⛔ Do not publish an interim Distilled package until generate+copy from a
  real vendor schema ([distilled-interim.md](./distilled-interim.md) steps 1–2).
- ⛔ Do not invent a Traefik Distilled SDK without an official schema.
- ⛔ Alchemy Argo / Kubernetes work is gated on a live Talos-on-PVE cluster.
  [#240](https://github.com/taslabs-net/homeflare-kit/pull/240) stays draft
  until then.
- Prefer upstream Alchemy Kubernetes resources when they exist (S1).

## Placeholder variables

Names a consuming stack substitutes. Origins use RFC 2606 `*.example.com`.
Addresses use RFC 5737 documentation ranges. Secret _values_ never appear —
only env-var NAMES (S25). Nothing here is applied.

### Topology — 3 control plane + 3 workers

| variable                       | placeholder                     |
| ------------------------------ | ------------------------------- |
| `TALOS_CLUSTER_NAME`           | `dogfood`                       |
| `TALOS_CP_NODES`               | `cp-a`, `cp-b`, `cp-c`          |
| `TALOS_WORKER_NODES`           | `wk-a`, `wk-b`, `wk-c`          |
| `TALOS_CP_ADDRESSES`           | `192.0.2.10/24` … `.12`         |
| `TALOS_WORKER_ADDRESSES`       | `192.0.2.20/24` … `.22`         |
| `TALOS_CONTROL_PLANE_ENDPOINT` | `https://k8s.example.com:6443`  |
| `TALOS_VERSION`                | `v1.13.x` (never measured live) |
| `STORAGE_CLASS`                | `STORAGE_CLASS`                 |
| `STORAGE_SIZE`                 | `STORAGE_SIZE`                  |

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
- No rewrite of `@homeflare/alchemy/talos`.
- No Alchemy provider code on this page, and none until the Talos-on-PVE gate
  lifts.
- No `packages/distilled-traefik`, `packages/distilled-cilium`, or other
  interim Distilled packages for this stack.
