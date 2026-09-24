---
'@homeflare/alchemy': minor
---

New `argocd/*` family — `Argocd.Repository`, `Argocd.RepoCreds` and `Argocd.Cluster`, on
`@distilled.cloud/argocd@1.0.0-rc.12` (measured published, matching the kit's own `effect`/core
pins — added as a direct peer dependency, the same shape as `forgejo`/`discord`). Built ahead of
need, per Tim's "we are using talos on pve once we get things settled ... i thought we are using
argocd, i wanted it on the radar" and "even if we don't use it yet but we know we will" — **no
Talos-on-PVE cluster and no Argo CD instance exist on the estate yet**; every test runs against a
fake, never a real server.

**Upstream check first (decision 49).** `alchemy-run/alchemy` v2.0.0-beta.79 ships no ArgoCD
provider at all — the only two `argocd` hits in the whole repo are an unrelated AWS EKS add-on
capability name in a JSDoc example. So there is nothing upstream to duplicate.

**The REST-vs-CRD split is the actual design decision, and it is why `Application`/`AppProject`
are deliberately NOT in this family.** Both are real Kubernetes CRDs (`argoproj.io/v1alpha1`,
their own versioned OpenAPI schema, listable with plain `kubectl`) — the upstream-correct owner is
Alchemy's own `Kubernetes.Manifest` (`src/Kubernetes/Manifest.ts`, which already documents a
"Custom resource (CRD)" example), not a house REST wrapper around the same object. Repository,
RepoCreds and Cluster are different: Argo CD's own storage for them is a `Secret` labeled with its
own private convention (`argocd.argoproj.io/secret-type: repository|repo-creds|cluster`) — not a
published Kubernetes API type, so the REST SDK is the only correct owner. Full reasoning, citations
and worked `Kubernetes.Manifest` examples for `Application`/`AppProject`:
`packages/alchemy/docs/argocd.md` and `docs/argocd-kubernetes.md`.

**A real, measured SDK-gap check that came back clean, unlike Discord's.** No `patches/` directory
exists for `packages/argocd` in distilled (homeflare/base) — every generated operation's own
declared `errors` array is just `[UnknownArgocdError]`. That looks like Discord's documented gap
(`docs/discord.md#sdk-gaps`) at first read. It is not: `protocol.ts` types every operation's shared
error channel from `API_ERRORS` (the full `HTTP_STATUS_MAP` set, not the narrower
`DEFAULT_ERRORS` Discord's channel is built from), and `core/protocol-rest.ts#decode` maps any
4xx status through `HTTP_STATUS_MAP` unconditionally after the per-op typed matchers, regardless
of what the operation itself declared. `catchTag('NotFound', ...)` works correctly today — proven
against the real protocol and a fake 404/401/403 in `repository.test.ts`, `repo-creds.test.ts` and
`cluster.test.ts`, not asserted by reading the source alone. No distilled patch was needed.

**Secrets never in state.** Every credential field (a repo's password/SSH key/bearer token/TLS
client key, a cluster's password/bearer token/TLS client key) is a prop typed `FromEnv`
(`../secrets/write-only.ts`), resolved from the deploying process's own environment at call time
and refused with a typed domain error when unset — never a literal value on a stack file, an
attribute, or in Alchemy's state store. No drift detection on those fields, the same
simplification `forgejo/org-actions-secrets.ts` already makes for the identical problem (Argo CD's
`Get`/`List` never returns them back): written once on create, rotated by destroy-then-create.

**Shape.** One shared engine (`resource.ts`) — a near-verbatim copy of `forgejo/resource.ts`, since
both SDKs are plain bearer-REST with a genuine typed `NotFound`. `reconcile` is a single upsert
call (every `Create*` operation this family calls takes `upsert: true` as a query parameter,
converging create-or-update in one request — no separate `Update*` path to wire). No `adopt(true)`/
`Unowned` wrapping, mirroring forgejo's own choice rather than discord's/netbox's marker.

**Tests**: 20 cases across the three resources, covering a live decode, a 404 folding to absent, a
401/403 propagating (never folded), idempotent delete (no DELETE call against an already-absent
object), and the write-only credential refusal/resolution path — all against `fake-argocd.ts`, a
loopback fake exercising the real distilled protocol, never a real Argo CD server.
