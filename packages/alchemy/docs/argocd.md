# Argo CD — `@homeflare/alchemy/argocd`

Built 2026-09-24, ahead of need — Tim: "we are using talos on pve once we get things settled ...
i thought we are using argocd, i wanted it on the radar" and "even if we don't use it yet but we
know we will." **No Talos-on-PVE cluster and no Argo CD instance exist on the estate yet.** Every
test in this family runs against `fake-argocd.ts`; nothing here has touched a real server.

## Is `@distilled.cloud/argocd` real, and does it match the kit's pins?

✅ **MEASURED**, `npm view @distilled.cloud/argocd`, 2026-09-24: published, `latest` =
**1.0.0-rc.12**, `peerDependencies.effect` = `>=4.0.0-rc.115`, `dependencies["@distilled.cloud/
core"]` = `1.0.0-rc.12` — exactly the kit's own pins (`packages/alchemy/package.json`'s `effect`
and every other `@distilled.cloud/*` peer). Added as a direct peer dependency, the same shape as
`@distilled.cloud/forgejo`/`discord`/`cloudflare`/`google-workspace` — **no interim package**
([docs/distilled-interim.md](./distilled-interim.md) applies only when the real package is
unpublished; it is not, here).

## Does upstream Alchemy already ship (or build) ArgoCD? (decision 49)

✅ **MEASURED, no**: `grep -ril "argocd"` across `alchemy-run/alchemy` v2.0.0-beta.79 matches
exactly two files, both AWS EKS "add-on capability" JSDoc examples (`src/AWS/EKS/
DescribeCapability.ts:20`, `ListCapabilities.ts` — `describeCapability({ capabilityName: "argocd"
})`, an EKS add-on name, unrelated to a provider). No `src/Argocd/` directory, no changeset, no
CHANGELOG entry. So decision 49 ("upstream wins... don't build a second one") does not apply here
— there is nothing upstream to duplicate.

## What upstream's `Kubernetes` family already ships (measured)

`packages/alchemy/src/Kubernetes/` (v2.0.0-beta.79): `Connection.ts`, `ClusterAdapter.ts`,
`BuiltinAdapters.ts`, `Deployment.ts`, `HelmChart.ts`, `Job.ts`, `Manifest.ts`, `Providers.ts`.
`Kubernetes.Manifest` (`Manifest.ts:34-284`) applies **any literal Kubernetes object — built-in
kinds and CRDs alike** via server-side apply, with a worked "Custom resource (CRD)" example in its
own doc comment (`Manifest.ts:116-127`). This is the upstream-correct owner for `Application` and
`AppProject` — see [argocd-kubernetes.md](./argocd-kubernetes.md) for why and how, with examples.
`HelmChart.ts` is how the house will install Argo CD itself later (its own Helm chart) — no new
code needed there either.

## The REST-vs-CRD split (the actual design decision)

Measured against Argo CD's declarative-setup documentation and the generated operation list in
`@distilled.cloud/argocd`'s `services/argocd.ts` (106 operations, distilled homeflare/base):

| Object        | Backing store                                                                                                                                          | Owner                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `Application` | `argoproj.io/v1alpha1` CRD, its own OpenAPI schema, listable with plain `kubectl`                                                                      | **`Kubernetes.Manifest`** — [argocd-kubernetes.md](./argocd-kubernetes.md) |
| `AppProject`  | `argoproj.io/v1alpha1` CRD, same as above                                                                                                              | **`Kubernetes.Manifest`**                                                  |
| Repository    | a `Secret` labeled `argocd.argoproj.io/secret-type: repository` — no CRD of its own; Argo CD's own storage format, not a published Kubernetes API type | **`Argocd.Repository`** (this family)                                      |
| RepoCreds     | a `Secret` labeled `…secret-type: repo-creds` — same reasoning                                                                                         | **`Argocd.RepoCreds`**                                                     |
| Cluster       | a `Secret` labeled `…secret-type: cluster` — same reasoning                                                                                            | **`Argocd.Cluster`**                                                       |

The line is not "REST API exists" (all seven have full REST CRUD — `ApplicationServiceService`,
`ProjectService`, `RepositoryService`, `RepoCredsService`, `ClusterService`) — it is **whether the
object is a real, versioned Kubernetes API type**. `Application`/`AppProject` are; Repository/
RepoCreds/Cluster are Argo CD's own encoding smuggled into a generic `Secret`, which
`Kubernetes.Manifest` could technically apply too, but only by hand-reconstructing Argo CD's
private labeling convention — exactly the vendor-specific knowledge a REST SDK exists to own.

## What this family builds

Three resources on `@distilled.cloud/argocd/argocd`, the peer-dependency pattern
`packages/alchemy/src/forgejo` already uses:

- **`Argocd.Repository`** (`repository.ts`) — `/api/v1/repositories`.
- **`Argocd.RepoCreds`** (`repo-creds.ts`) — `/api/v1/repocreds`, a URL-prefix credential
  template. No single-item `Get` operation exists (measured against the operation list) —
  `fetchLive` lists and finds, the same shape `forgejo/org-actions-secrets.ts` and
  `discord/guild-application-command.ts` use for the same reason.
- **`Argocd.Cluster`** (`cluster.ts`) — `/api/v1/clusters`. Only bearer-token and static
  TLS-client-cert auth are modeled; `awsAuthConfig` (EKS IAM) and `execProviderConfig` (an exec
  plugin) are unbuilt — neither applies to a Talos cluster.

All three share one engine (`resource.ts`, `argocdOperations`/`argocdHandlers`), a near-verbatim
copy of `forgejo/resource.ts` — both SDKs are plain bearer-REST with a real typed `NotFound`, so
the same read/diff/reconcile/destroy shape applies unchanged.

## The SDK gap that _isn't_ there (measured, and why it matters)

🔴 Unlike Discord (`docs/discord.md#sdk-gaps`), Argo CD's generated error TYPE is **not** narrowed
to `DEFAULT_ERROR_STATUSES`. Measured directly, `packages/argocd/src/protocol.ts` (distilled
homeflare/base):

```ts
export type ArgocdOpError =
  | InstanceType<(typeof API_ERRORS)[number]> // the FULL 12-class list, incl. NotFound/Forbidden/Conflict
  | UnknownArgocdError
  | ConfigError
  | HttpClientError.HttpClientError;
```

`API_ERRORS` (not `DEFAULT_ERRORS`) is the full `HTTP_STATUS_MAP` set. And no operation carries a
`patches/` file (`git ls-tree` on `packages/argocd/` shows none, unlike forgejo's `patches/
organization/orgDelete.json` exemplar) — every op's own declared `errors: [...]` array is just
`[UnknownArgocdError]`. That looked, at first read, like the same gap Discord has. It is not:
`core/protocol-rest.ts#decode` (lines ~320-370) checks the operation's own typed matchers first,
then **unconditionally** falls back to `HTTP_STATUS_MAP[status]` — a 404 maps to `NotFound`
regardless of whether the operation declared it. `UnknownArgocdError` is reached only for a status
outside that map. **So `catchTag('NotFound', ...)` works correctly today, with no distilled patch
needed** — confirmed by `repository.test.ts`/`repo-creds.test.ts`/`cluster.test.ts` running the
REAL protocol against a fake 404/401/403, not a hand-rolled status check.

## Secrets never in state

Every secret-shaped field (`password`, `sshPrivateKey`, `bearerToken`, `tlsClientCertKey` /
`tlsClientKeyData`) is a prop typed `FromEnv` (`{ fromEnv: 'ENV_VAR_NAME' }`,
`../secrets/write-only.ts`) — never a literal value. `git-credentials.ts` (Repository/RepoCreds)
and `cluster.ts`'s own resolver read the named variable from the deploying process's own
environment **at call time**, refuse with a typed domain error
(`ArgocdSecretEnvUnsetError`/`ArgocdClusterSecretEnvUnsetError`) if it is unset, and send the
value on the wire — never into a prop, an attribute, or Alchemy's state store.

⚠️ **No drift detection on secret fields, on purpose** — the same simplification
`forgejo/org-actions-secrets.ts` makes: Argo CD's `Get`/`List` never returns a password, private
key or bearer token back, so there is nothing to diff against. `matches` compares only the fields
the API does return; a changed credential is written once on create and never rotated
automatically. Rotate by destroy-then-create, or a manual call outside Alchemy. A seal-based check
(`../secrets/write-only.ts#seal`, as `proxmox/pbs-notification-target-lifecycle.ts` uses) is
possible later if this becomes a real problem.

## Reconcile is one upsert call, always

Every `Create*` operation this family calls takes `upsert: true` as a query parameter (measured:
`CreateRepositoryServiceRepositoryRequest`, `CreateRepoCredsServiceRepositoryCredentialsRequest`,
`CreateClusterServiceRequest`, all `.pipe(T.Query())`) — a true create-or-converge in one request.
`resource.ts#reconcile` therefore has no separate `Update*` path: it reads, and calls `upsert`
only when the declared props and the live object disagree on a plain field (S10 — converged means
zero writes).

## `exactOptionalPropertyTypes`, and `present()`

The kit's `tsconfig.base.json` turns this on, and every generated Argo CD request type declares
optional fields the strict way. `resource.ts#present()` strips undefined-valued keys into
genuinely-absent keys before any create/upsert call — one shared helper instead of
`forgejo/repository.ts#editForm`'s per-field conditional spread repeated three times.

## Ownership: silent, like forgejo — not `Unowned` like discord/netbox

No `adopt(true)`/`Unowned` wrapping. A live object found on a cold read (no persisted state) is
treated as ours, mirroring `forgejo/resource.ts`'s own choice rather than `discord/resource.ts`'s
`Unowned` marker. Documented, not accidental — the same tradeoff forgejo already ships with.
