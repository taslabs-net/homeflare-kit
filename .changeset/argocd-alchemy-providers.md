---
'@homeflare/alchemy': minor
---

New family: `@homeflare/alchemy/argocd`. `ArgoCD.Application`, `ArgoCD.AppProject`,
`ArgoCD.Repository` and `ArgoCD.ApplicationSet` declare GitOps objects on an Argo CD
server, calling `@distilled.cloud/argocd@1.0.0-rc.12`'s typed operations
(`create`/`get`/`update`/`delete` ApplicationService, ProjectService,
RepositoryService, and ApplicationSetService create-with-upsert — Distilled has no
ApplicationSet PUT). Every vendor error is `catchTag`'d; a 404 folds to absent.

Credentials are a per-instance target (`baseUrl` + `tokenEnv` NAME), never a
literal token or a prop. Repository passwords use `passwordEnv` the same way
(S25). Cold `read` answers `Unowned`; convenience constructors pipe `adopt(true)`;
every resource defaults `retain`.

Walked 2026-09-24 against the published Distilled tarball, not a live cluster.
Alchemy pin unchanged (`2.0.0-beta.79`). Non-goals: no Flux, no rewrite of the
CLI/`talosctl` Talos family, no Distilled SDKs for Headlamp / Traefik / Cilium /
CNPG / Valkey / Talos API. Placeholder Talos dogfood sketch:
`docs/talos-argocd-dogfood.md`.
