/**
 * Argo CD providers for Alchemy.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, AND IT IS DELIBERATELY SMALLER THAN THE DIRECTORY. These are
 *   the symbols a real stack consumes; `resource.ts`, `application-form.ts` and `fake-argocd.ts`
 *   are internals a provider needs but a consumer should not depend on.
 *
 * ★ FOUR RESOURCES, ALL DISTILLED-BACKED. Application, AppProject, Repository, ApplicationSet —
 *   every vendor call goes through `@distilled.cloud/argocd@1.0.0-rc.12`. Gaps (RepoCreds,
 *   write-repositories, non-git ApplicationSet generators, Cluster) are listed in docs/argocd.md,
 *   not worked around with a second HTTP client.
 */
export {
  application,
  ArgoCDApplication,
  ArgoCDApplicationProvider,
  isArgoCDApplication,
  type ApplicationAttributes,
  type ApplicationProps,
} from './application.ts';
export {
  applicationSet,
  ArgoCDApplicationSet,
  ArgoCDApplicationSetProvider,
  isArgoCDApplicationSet,
  type ApplicationSetAttributes,
  type ApplicationSetProps,
} from './application-set.ts';
export {
  appProject,
  ArgoCDAppProject,
  ArgoCDAppProjectProvider,
  isArgoCDAppProject,
  type AppProjectAttributes,
  type AppProjectProps,
} from './app-project.ts';
export {
  argocdCredentials,
  Credentials,
  CredentialsFromEnv,
  fromToken,
  type ArgoCDCredentialsConfig,
  type ArgoCDTarget,
} from './credentials.ts';
export { argocdProviders } from './providers.ts';
export {
  repository,
  ArgoCDRepository,
  ArgoCDRepositoryProvider,
  ArgoCDSecretRefUnsetError,
  isArgoCDRepository,
  type RepositoryAttributes,
  type RepositoryProps,
} from './repository.ts';
