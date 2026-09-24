# Talos + Argo CD dogfood — Distilled stub status

Placeholder stack: Talos Kubernetes, **Argo CD owns GitOps**. Variables and
IPs stay in the Argo provider slice
([PR 240](https://github.com/taslabs-net/homeflare-kit/pull/240)) — this
page is only the Distilled decision for each vendor that page listed as
"stub only".

## Non-goals

- No Flux.
- No rewrite of `@homeflare/alchemy/talos` (CLI / `talosctl`).
- No rewrite of the Argo CD Alchemy providers.
- ⛔ No `@distilled.cloud/<vendor>` aliases in `packages/alchemy` until the
  interim package is on npm (`npm view` would fail). Alias + provider PRs
  come after publish.

## Distilled status

`@distilled.cloud/kubernetes@1.0.0-rc.12` **exists on npm**. A vendor whose
control plane is Kubernetes CRDs uses that package, not a fake REST SDK.

| vendor    | decision               | package / note                                                                                                                                                                                                                      |
| --------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| headlamp  | **C — Skip**           | Kubernetes UI. Backend `/config` and cluster proxy are not a vendor control-plane API. Install via Argo Application / Helm. No `@homeflare/distilled-headlamp`.                                                                     |
| traefik   | **B — Scaffold**       | `@homeflare/distilled-traefik` — documented `GET /api/…` dashboard API, **no official OpenAPI**. One stub op: `getVersion`. Experimental flags are Helm values.                                                                     |
| cilium    | **B — Scaffold**       | `@homeflare/distilled-cilium` — official swagger 2.0 at `cilium/cilium` `api/v1/openapi.yaml` (A candidate). This PR ships a stub (`getHealthz`) so a name can publish; regenerate+copy replaces `src/`. BGP is a consumer concern. |
| cnpg      | **C — Use kubernetes** | CloudNativePG is `postgresql.cnpg.io/v1` CRDs (`Cluster`, `Backup`, `Pooler`, …). No separate REST control plane. Use `@distilled.cloud/kubernetes`. No `@homeflare/distilled-cnpg`.                                                |
| valkey    | **C — Use kubernetes** | Valkey Sentinel is RESP (`SENTINEL` on :26379), not HTTP. Operators (`valkey-io/valkey-operator`, `SAP/valkey-operator`) are CRDs. Use `@distilled.cloud/kubernetes`. No `@homeflare/distilled-valkey`.                             |
| talos API | out of scope           | CLI family stays. No Distilled Talos API in this PR.                                                                                                                                                                                |
| argo      | already on npm         | `@distilled.cloud/argocd` — PR 240. Do not redo.                                                                                                                                                                                    |

## Why C for Headlamp / CNPG / Valkey

Inventing a REST Distilled package for a UI-only dashboard or a CRD-only
operator would make Alchemy look like it talks to a vendor API that does
not exist. The failure mode is a provider that `catchTag`s errors from a
client nobody can regenerate from an upstream spec.

CNPG "API reference" **is** the CRD schema
(https://cloudnative-pg.io/documentation/1.27/cloudnative-pg.v1/).
Valkey Sentinel's API is the Valkey protocol
(https://valkey.io/topics/sentinel/). Headlamp is
https://github.com/kubernetes-sigs/headlamp plus its Helm chart.

## Cutover for the two scaffolds

Same five steps as [distilled-interim.md](./distilled-interim.md):

1. Merge this PR; changeset publishes `@homeflare/distilled-traefik` and
   `@homeflare/distilled-cilium`.
2. Confirm `npm view @homeflare/distilled-<vendor> version`.
3. Follow-up: alias in the consuming package
   (`"@distilled.cloud/traefik": "npm:@homeflare/distilled-traefik@…"`).
4. Follow-up: Alchemy providers that call those operations.
5. When `@distilled.cloud/<vendor>` exists upstream: swap the alias, delete
   the interim package. **STATE MUST NOT MOVE.**

Cilium's next interim bump should be the generate+copy from
`raw.githubusercontent.com/cilium/cilium/main/api/v1/openapi.yaml`
(Distilled skill, Steps 1–8 only — ⛔ never push to `alchemy-run/distilled`).

## License

Docs in this package ship with `@homeflare/alchemy` (MIT). The two new
interim SDKs are Apache-2.0.
