/**
 * Argo CD providers for Alchemy.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, AND IT IS DELIBERATELY SMALLER THAN THE DIRECTORY. `resource.ts`
 *   and `git-credentials.ts` are internals the three resource files share — a consumer builds
 *   against the resources and `providers()`, not the engine underneath.
 *
 * ★ `Application` AND `AppProject` ARE NOT HERE — they are Kubernetes CRDs, not Argo CD REST-only
 *   objects, and the upstream-correct owner is Alchemy's own `Kubernetes.Manifest`
 *   (`alchemy/Kubernetes`, v2.0.0-beta.79). See `docs/argocd.md#applications-and-appprojects` for
 *   the measured reasoning and worked examples — no code for those two lives in this kit.
 */
export {
  ArgocdCluster,
  ArgocdClusterProvider,
  type ClusterAttributes,
  type ClusterCredentialRefs,
  type ClusterProps,
} from './cluster.ts';
export {
  type ArgocdCredentialsConfig,
  Credentials,
  CredentialsFromEnv,
  fromEnv,
  fromToken,
} from './credentials.ts';
export { type ArgocdSecretEnvUnsetError, type GitCredentialRefs } from './git-credentials.ts';
export { providers } from './providers.ts';
export {
  ArgocdRepoCreds,
  ArgocdRepoCredsProvider,
  type RepoCredsAttributes,
  type RepoCredsProps,
} from './repo-creds.ts';
export {
  ArgocdRepository,
  ArgocdRepositoryProvider,
  type RepositoryAttributes,
  type RepositoryProps,
} from './repository.ts';
