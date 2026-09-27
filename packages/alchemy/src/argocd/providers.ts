/**
 * All three Argo CD providers as one layer for a stack.
 *
 *     Layer.mergeAll(argocdProviders(), …the stack's other providers)
 *       .pipe(Layer.provide(FetchHttpClient.layer))
 *
 * Mirrors `../discord/providers.ts`: `FetchHttpClient.layer` is the stack's own responsibility to
 * provide (the shared transport every family needs), not something a single vendor's `providers()`
 * should pin.
 */
import * as Layer from 'effect/Layer';
import { ArgocdClusterProvider } from './cluster.ts';
import { ArgocdRepoCredsProvider } from './repo-creds.ts';
import { ArgocdRepositoryProvider } from './repository.ts';

export const providers = () =>
  Layer.mergeAll(ArgocdRepositoryProvider(), ArgocdRepoCredsProvider(), ArgocdClusterProvider());
