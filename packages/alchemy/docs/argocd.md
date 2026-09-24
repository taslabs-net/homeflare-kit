# Argo CD — `@homeflare/alchemy/argocd`

Application, AppProject, Repository and ApplicationSet, generated from
`@distilled.cloud/argocd@1.0.0-rc.12`. Every vendor call goes through that SDK;
`catchTag('NotFound', …)` folds absence. Walked 2026-09-24 against the published
tarball (not a live cluster) — Alchemy `2.0.0-beta.79`, distilled commit the
`1.0.0-rc.12` tag pins.

## Resource set

| resource                | Distilled ops                                              | identity        |
| ----------------------- | ---------------------------------------------------------- | --------------- |
| `ArgoCD.Application`    | `create` / `get` / `update` / `delete` ApplicationService  | `metadata.name` |
| `ArgoCD.AppProject`     | `create` / `get` / `update` / `delete` ProjectService      | `metadata.name` |
| `ArgoCD.Repository`     | `create` / `get` / `update` / `delete` RepositoryService   | repo URL        |
| `ArgoCD.ApplicationSet` | `create` (upsert) / `get` / `delete` ApplicationSetService | `metadata.name` |

Sync-relevant Application attrs are `syncPolicy` (automated / prune / selfHeal /
syncOptions). `syncApplicationService` is a one-shot, not desired state — there
is no `ArgoCD.Sync` resource.

`read` answers `Unowned` on a cold match (H1). Convenience constructors
(`application`, `appProject`, `repository`, `applicationSet`) pipe `adopt(true)`
(H5). Every constructor defaults `retain` (H4).

## Credentials

A target — instance origin plus a token env var NAME, never a literal (S25):

```ts
import { argocdProviders } from '@homeflare/alchemy/argocd';

const cluster = argocdProviders({
  baseUrl: 'https://argocd.example.com',
  tokenEnv: 'ARGOCD_TOKEN',
});
```

Distilled's own `CredentialsFromEnv` (`ARGOCD_TOKEN` / `ARGOCD_SERVER`) is
re-exported. ⚠️ It defaults the server to `https://localhost:8080` — the
parameterized target is what a Talos stack should use.

Repository passwords use `passwordEnv` (an env var NAME). Distilled already
marks the wire field `SensitiveValue` / `Redacted`. The GET never returns the
secret; `matches` cannot see password drift.

## SDK gaps — recorded, not worked around

Distilled covers these and this family does **not** model them yet:

- **RepoCreds** and write-repositories (URL-prefix credential sets).
- **ApplicationSet generators** other than git (list, cluster, matrix, merge,
  plugin, pullRequest, scmProvider, clusterDecisionResource).
- **Cluster** (`createClusterService` / `updateClusterService`) — destination
  here is an in-cluster placeholder (`https://kubernetes.default.svc`), not a
  registered cluster object.
- **Project roles / JWT tokens / sync windows** — a role token is a credential
  (S25); sync windows wait for a stack that declares one.

S1: Alchemy 2.0.0-beta.79 ships no Argo CD family. Flux is out of scope — Argo
CD owns cluster GitOps. The existing `talos/` family stays CLI/`talosctl` and
is not rewritten here.

Placeholder Talos stack sketch: [talos-argocd-dogfood.md](./talos-argocd-dogfood.md).
