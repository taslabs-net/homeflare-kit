# Talos + Argo CD dogfood — placeholder stack sketch

First slice of a Talos Kubernetes dogfood stack where **Argo CD owns cluster
GitOps**. Variables and placeholders only — no real IPs, secrets, or inventory.

This is a sketch, not a stack file. Nothing here is applied.

## Non-goals

- No Flux. Argo CD is the GitOps controller.
- No rewrite of `@homeflare/alchemy/talos` (CLI / `talosctl`).
- No Distilled SDKs for Headlamp, Traefik, Cilium, CNPG, Valkey, or Talos API
  in this slice.

## Variable schema

Every value is a name a consuming stack substitutes. Origins use RFC 2606
`*.example.com`. Addresses use RFC 5737 documentation ranges if a field
requires an address-shaped placeholder.

### Cluster topology — 3 control plane + 3 workers

| variable                       | meaning                                            | placeholder                    |
| ------------------------------ | -------------------------------------------------- | ------------------------------ |
| `TALOS_CLUSTER_NAME`           | cluster name Argo destination / Talos config share | `dogfood`                      |
| `TALOS_CP_NODES`               | three control-plane node names                     | `cp-a`, `cp-b`, `cp-c`         |
| `TALOS_WORKER_NODES`           | three worker node names                            | `wk-a`, `wk-b`, `wk-c`         |
| `TALOS_CP_ADDRESSES`           | documentation-range CP addresses                   | `192.0.2.10/24` … `.12`        |
| `TALOS_WORKER_ADDRESSES`       | documentation-range worker addresses               | `192.0.2.20/24` … `.22`        |
| `TALOS_CONTROL_PLANE_ENDPOINT` | VIP / DNS for the API                              | `https://k8s.example.com:6443` |
| `TALOS_VERSION`                | machine image pin                                  | `v1.13.x` (unmeasured live)    |

### Argo CD (this family — implemented)

| variable                    | meaning                                   | placeholder                              |
| --------------------------- | ----------------------------------------- | ---------------------------------------- |
| `ARGOCD_SERVER`             | API origin (no `/api/v1`)                 | `https://argocd.example.com`             |
| `ARGOCD_TOKEN_ENV`          | env var NAME for the bearer token         | `ARGOCD_TOKEN`                           |
| `ARGOCD_PROJECT`            | AppProject name                           | `platform`                               |
| `ARGOCD_GITOPS_REPO`        | git URL registered as `ArgoCD.Repository` | `https://git.example.com/org/gitops.git` |
| `ARGOCD_GITOPS_REVISION`    | target revision                           | `main`                                   |
| `ARGOCD_DESTINATION_SERVER` | in-cluster Kubernetes                     | `https://kubernetes.default.svc`         |
| `ARGOCD_APPS_PATH`          | Application / ApplicationSet path         | `apps/*`                                 |

Token value lives in the named env var, never in the stack file (S25).

### Cilium BGP

| variable                     | meaning                    | placeholder        |
| ---------------------------- | -------------------------- | ------------------ |
| `CILIUM_BGP_CLUSTER_ASN`     | cluster ASN                | `64512` (private)  |
| `CILIUM_BGP_PEER_ASN`        | peer ASN                   | `64513`            |
| `CILIUM_BGP_PEER_ADDRESS`    | peer (documentation range) | `198.51.100.1`     |
| `CILIUM_BGP_ADVERTISE_POOLS` | pod / service CIDR names   | `pods`, `services` |

### Traefik (experimental flags on)

| variable                     | meaning                            | placeholder                    |
| ---------------------------- | ---------------------------------- | ------------------------------ |
| `TRAEFIK_ENTRYPOINTS`        | listen entrypoints                 | `web`, `websecure`             |
| `TRAEFIK_EXPERIMENTAL_FLAGS` | experimental feature flags, all on | `kubernetesGateway`, `knative` |
| `TRAEFIK_NAMESPACE`          | install namespace                  | `traefik`                      |

### Headlamp

| variable                | meaning               | placeholder            |
| ----------------------- | --------------------- | ---------------------- |
| `HEADLAMP_INGRESS_HOST` | UI host               | `headlamp.example.com` |
| `HEADLAMP_NAMESPACE`    | install namespace     | `headlamp`             |
| `HEADLAMP_INCLUSTER`    | in-cluster kubeconfig | `true`                 |

### CNPG Postgres

| variable                    | meaning                          | placeholder               |
| --------------------------- | -------------------------------- | ------------------------- |
| `CNPG_CLUSTER_NAME`         | Cluster CR name                  | `dogfood-pg`              |
| `CNPG_INSTANCES`            | replicas                         | `3`                       |
| `CNPG_STORAGE_SIZE`         | PVC size name                    | `STORAGE_SIZE`            |
| `CNPG_SUPERUSER_SECRET_ENV` | env var NAME, never the password | `CNPG_SUPERUSER_PASSWORD` |

### Valkey Sentinel

| variable                 | meaning                          | placeholder       |
| ------------------------ | -------------------------------- | ----------------- |
| `VALKEY_SENTINEL_NAME`   | sentinel monitor name            | `dogfood-valkey`  |
| `VALKEY_REPLICAS`        | replica count                    | `3`               |
| `VALKEY_SENTINEL_QUORUM` | quorum                           | `2`               |
| `VALKEY_PASSWORD_ENV`    | env var NAME, never the password | `VALKEY_PASSWORD` |

## Ownership

Argo CD Applications (and ApplicationSets) in `ARGOCD_PROJECT` are the desired
state for Cilium, Traefik, Headlamp, CNPG and Valkey. Alchemy declares the
Argo objects; Argo reconciles the cluster. A second GitOps controller is a
conflict, not a fallback.

## Next: Distilled stubs

House resources wait on a `@distilled.cloud/<vendor>` package (or a kit
interim copy — [distilled-interim.md](./distilled-interim.md)). Checklist:

| vendor      | why                                         | status this PR              |
| ----------- | ------------------------------------------- | --------------------------- |
| headlamp    | dashboard install / OIDC                    | stub only                   |
| traefik     | ingress / experimental flags                | stub only                   |
| cilium      | BGP / CNI                                   | stub only                   |
| talos (API) | machine / cluster config without `talosctl` | stub only; CLI family stays |
| cnpg        | Postgres Cluster CR                         | stub only                   |
| valkey      | Sentinel topology                           | stub only                   |
