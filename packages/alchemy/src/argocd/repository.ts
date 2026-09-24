/**
 * `Argocd.Repository` — a git/helm/OCI source registered with an Argo CD instance
 * (`/api/v1/repositories`). REST-managed, NOT a Kubernetes CRD — see `docs/argocd.md` for the
 * measured split between this family and `Kubernetes.Manifest` (upstream Alchemy's family, for
 * `Application`/`AppProject`, which genuinely are CRDs).
 *
 * ⚠️ NO LIVE ARGO CD INSTANCE EXISTS ON THE ESTATE (2026-09-24). Built ahead of the Talos-on-PVE
 *   cluster this targets; every test runs against `fake-argocd.ts`. See `docs/argocd.md`.
 *
 * ⛔ `defaultRemovalPolicy: 'retain'` — deregistering a repository Argo CD applications still
 *   reference breaks their sync, the same reasoning `forgejo/repository.ts` gives for git repos.
 *   `delete` below is fully implemented; opt in with `.pipe(RemovalPolicy.destroy())`.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as argocd from '@distilled.cloud/argocd/argocd';
import * as Effect from 'effect/Effect';
import {
  type ArgocdSecretEnvUnsetError,
  type GitCredentialRefs,
  resolveGitCredentials,
} from './git-credentials.ts';
import { type ArgocdRequirements, type ArgocdSpec, argocdHandlers, present } from './resource.ts';

export interface RepositoryProps {
  /** The repository URL — identity key; changing it is a replace, not an update. */
  repo: string;
  /** "git" (default), "helm" or "oci". */
  type?: string;
  /** Required for "helm" repositories (Argo CD indexes helm repos by name, not URL). */
  name?: string;
  /** Restricts this repository to one Argo CD project; omit for every project. */
  project?: string;
  username?: string;
  insecure?: boolean;
  insecureIgnoreHostKey?: boolean;
  enableLfs?: boolean;
  enableOCI?: boolean;
  forceHttpBasicAuth?: boolean;
  proxy?: string;
  noProxy?: string;
  /** The client certificate itself — public, unlike its key. */
  tlsClientCertData?: string;
  /** Write-only — see `git-credentials.ts`. Never a value here, only env var names. */
  credentials?: GitCredentialRefs;
}

export interface RepositoryAttributes {
  repo: string;
  type: string | undefined;
  name: string | undefined;
  project: string | undefined;
  username: string | undefined;
  insecure: boolean | undefined;
  insecureIgnoreHostKey: boolean | undefined;
  enableLfs: boolean | undefined;
  enableOCI: boolean | undefined;
  forceHttpBasicAuth: boolean | undefined;
  proxy: string | undefined;
  noProxy: string | undefined;
  tlsClientCertData: string | undefined;
}

export interface ArgocdRepository extends Resource<
  'Argocd.Repository',
  RepositoryProps,
  RepositoryAttributes,
  never,
  ArgocdRequirements
> {}

export const ArgocdRepository = Resource<ArgocdRepository>('Argocd.Repository', {
  defaultRemovalPolicy: 'retain',
});

const attributesOf = (live: argocd.V1alpha1Repository): RepositoryAttributes => ({
  enableLfs: live.enableLfs,
  enableOCI: live.enableOCI,
  forceHttpBasicAuth: live.forceHttpBasicAuth,
  insecure: live.insecure,
  insecureIgnoreHostKey: live.insecureIgnoreHostKey,
  name: live.name,
  noProxy: live.noProxy,
  project: live.project,
  proxy: live.proxy,
  repo: live.repo ?? '',
  tlsClientCertData: live.tlsClientCertData,
  type: live.type,
  username: live.username,
});

/** Only the plain fields — see `git-credentials.ts` for why the secret fields are excluded. */
const plainMatches = (attrs: RepositoryAttributes, props: RepositoryProps): boolean =>
  (props.type ?? 'git') === (attrs.type ?? 'git') &&
  (props.name ?? undefined) === (attrs.name ?? undefined) &&
  (props.project ?? undefined) === (attrs.project ?? undefined) &&
  (props.username ?? undefined) === (attrs.username ?? undefined) &&
  Boolean(props.insecure) === Boolean(attrs.insecure) &&
  Boolean(props.insecureIgnoreHostKey) === Boolean(attrs.insecureIgnoreHostKey) &&
  Boolean(props.enableLfs) === Boolean(attrs.enableLfs) &&
  Boolean(props.enableOCI) === Boolean(attrs.enableOCI) &&
  Boolean(props.forceHttpBasicAuth) === Boolean(attrs.forceHttpBasicAuth) &&
  (props.proxy ?? undefined) === (attrs.proxy ?? undefined) &&
  (props.noProxy ?? undefined) === (attrs.noProxy ?? undefined) &&
  (props.tlsClientCertData ?? undefined) === (attrs.tlsClientCertData ?? undefined);

type RepositoryError =
  | argocd.GetRepositoryServiceError
  | argocd.CreateRepositoryServiceRepositoryError
  | argocd.DeleteRepositoryServiceRepositoryError
  | ArgocdSecretEnvUnsetError;

/** ★ EXPORTED for direct testing against `fake-argocd.ts` — see `repository.test.ts`. */
export const spec: ArgocdSpec<
  RepositoryProps,
  argocd.V1alpha1Repository,
  RepositoryAttributes,
  RepositoryError
> = {
  attributes: (live) => attributesOf(live),
  destroy: (props) => argocd.deleteRepositoryServiceRepository({ repo: props.repo }),
  identityOfAttributes: (attrs) => attrs.repo,
  identityOfProps: (props) => props.repo,
  fetchLive: (props) =>
    argocd
      .getRepositoryService({ repo: props.repo })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  matches: plainMatches,
  upsert: (props) =>
    resolveGitCredentials(props.credentials ?? {}).pipe(
      Effect.flatMap((creds) =>
        argocd.createRepositoryServiceRepository(
          present({
            upsert: true,
            enableLfs: props.enableLfs,
            enableOCI: props.enableOCI,
            forceHttpBasicAuth: props.forceHttpBasicAuth,
            insecure: props.insecure,
            insecureIgnoreHostKey: props.insecureIgnoreHostKey,
            name: props.name,
            noProxy: props.noProxy,
            project: props.project,
            proxy: props.proxy,
            repo: props.repo,
            tlsClientCertData: props.tlsClientCertData,
            type: props.type,
            username: props.username,
            ...creds,
          }),
        ),
      ),
    ),
};

export const handlers = argocdHandlers(spec);

export const ArgocdRepositoryProvider = () =>
  Provider.effect(ArgocdRepository, Effect.succeed(ArgocdRepository.Provider.of(handlers)));
