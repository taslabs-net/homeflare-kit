# Argo CD `Application`/`AppProject` — via upstream's `Kubernetes` family, no new code

Companion to [argocd.md](./argocd.md#the-rest-vs-crd-split-the-actual-design-decision). `Application`
and `AppProject` are Kubernetes CRDs (`argoproj.io/v1alpha1`), not Argo CD REST-only objects — the
upstream-correct owner is Alchemy's own `Kubernetes.Manifest`
(`alchemy/Kubernetes`, v2.0.0-beta.79), which this kit does not wrap, re-implement, or need to:
decision 49 ("Kubernetes uses UPSTREAM Alchemy's existing Kubernetes family... don't build a
second one"). This page is documentation only — **no code in this kit declares an `Application` or
`AppProject`**; it shows how a stack does, once a cluster exists.

## Why not an `Argocd.Application` REST resource?

Argo CD's `ApplicationService` REST API is real and full-featured (`Create`/`Get`/`Update`/
`Patch`/`Delete`/`List`/`Sync`/`Rollback`/…), but underneath it the object it manages **is** the
`Application` CRD — the same object `kubectl get applications.argoproj.io -n argocd` lists, with
its own versioned OpenAPI schema, validated by the Kubernetes API server itself, not by Argo CD's
application logic. A second, house-maintained REST wrapper around that would duplicate exactly the
generic capability `Kubernetes.Manifest` already provides — apply any object, CRDs included, via
server-side apply — for no benefit over declaring the CRD directly. Argo CD's own docs recommend
exactly this: `kubectl`/GitOps management of `Application`/`AppProject` manifests is the primary
documented workflow, not a detour around the REST API.

## Declaring an `AppProject`

```ts
import * as Kubernetes from 'alchemy/Kubernetes';
import * as Effect from 'effect/Effect';

const project = Effect.gen(function* () {
  return yield* Kubernetes.Manifest('HomeflareProject', {
    cluster, // a Kubernetes.KubeConfig(...) or a managed cluster resource
    manifest: {
      apiVersion: 'argoproj.io/v1alpha1',
      kind: 'AppProject',
      metadata: { name: 'homeflare', namespace: 'argocd' },
      spec: {
        description: 'HomeFlare estate applications',
        sourceRepos: ['https://forgejo.homeflare.dev/homeflare/*'],
        destinations: [{ namespace: '*', server: 'https://kubernetes.default.svc' }],
        clusterResourceWhitelist: [{ group: '*', kind: '*' }],
      },
    },
  });
});
```

## Declaring an `Application`

```ts
const app = Effect.gen(function* () {
  return yield* Kubernetes.Manifest('HomeflareKitApp', {
    cluster,
    manifest: {
      apiVersion: 'argoproj.io/v1alpha1',
      kind: 'Application',
      metadata: { name: 'homeflare-kit', namespace: 'argocd' },
      spec: {
        project: 'homeflare',
        source: {
          repoURL: 'https://forgejo.homeflare.dev/homeflare/kit.git',
          targetRevision: 'main',
          path: 'deploy/manifests',
        },
        destination: { server: 'https://kubernetes.default.svc', namespace: 'homeflare-kit' },
        syncPolicy: { automated: { prune: true, selfHeal: true } },
      },
    },
  });
});
```

`Kubernetes.Manifest` resolves unknown kinds through the cluster's own API discovery endpoint
(`Manifest.ts:31-32,89-93`), so `Application`/`AppProject` need no house registration — the CRD
just has to already exist on the cluster (Argo CD's own install manifest creates it).

## Ordering: the CRD before the object

`Application`/`AppProject` are CRD-backed, so the `argoproj.io` `CustomResourceDefinition`s must
exist before a `Kubernetes.Manifest` for either can apply — normally true the moment Argo CD
itself is installed (its own install manifest, or `Kubernetes.HelmChart` installing the
`argo-cd` chart, both ship the CRDs). A stack that installs Argo CD and declares Applications in
the same deploy should thread the install as a dependency (an `Output` the Application's `cluster`
or an explicit ordering prop depends on) so Plan waits on it — an `Output` referenced in props is a
real dependency edge Alchemy's own Plan/Apply order on (v2.0.0-beta.79), the general rule this
follows.

## Registering the Talos-on-PVE cluster itself with Argo CD

Argo CD's own control-plane cluster (where Argo CD runs) never needs registering — it is implicit
as `https://kubernetes.default.svc`. A **separate** cluster Argo CD deploys onto (or, if Argo CD
itself runs off-cluster) uses `Argocd.Cluster` from this kit ([argocd.md](./argocd.md)) — that
registration genuinely is Argo CD's own non-CRD storage (a labeled `Secret`), covered by the REST
family, not this page.

## Installing Argo CD itself

Out of scope for this change (no cluster exists to install onto), but the answer is also "no new
code": `Kubernetes.HelmChart` (`alchemy/Kubernetes`) installs the upstream `argo-cd` Helm chart
the same way any other chart installs, and `Kubernetes.Manifest` covers a plain-manifest install
if the chart is not wanted. Neither needs anything from this kit.
