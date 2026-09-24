/**
 * The Argo CD providers for one instance, with its credentials, as one layer for a stack.
 *
 *     Layer.mergeAll(argocdProviders({ baseUrl: '...', tokenEnv: 'ARGOCD_TOKEN' }), …)
 *
 * ★ ONE CALL PER INSTANCE. A stack declaring against two Argo CD servers (two Talos clusters)
 *   composes `argocdProviders(targetA)` and `argocdProviders(targetB)` — each resource type is
 *   a single global registration; only the credential layer differs per call.
 * ⚠️ `HttpClient` is NOT provided here. It is ambient in every Alchemy runtime, the same as
 *   `grafanaProviders`/`litellmProviders` assume.
 */
import * as Layer from 'effect/Layer';
import { ArgoCDApplicationProvider } from './application.ts';
import { ArgoCDApplicationSetProvider } from './application-set.ts';
import { ArgoCDAppProjectProvider } from './app-project.ts';
import { type ArgoCDTarget, argocdCredentials } from './credentials.ts';
import { ArgoCDRepositoryProvider } from './repository.ts';

export const argocdProviders = (target: ArgoCDTarget) =>
  Layer.mergeAll(
    ArgoCDApplicationProvider(),
    ArgoCDAppProjectProvider(),
    ArgoCDRepositoryProvider(),
    ArgoCDApplicationSetProvider(),
  ).pipe(Layer.provide(argocdCredentials(target)));
