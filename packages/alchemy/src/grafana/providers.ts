/**
 * The Grafana providers for one instance, with its credentials, as one layer for a stack.
 *
 *     Layer.mergeAll(grafanaProviders({ baseUrl: '...', tokenEnv: 'GRAFANA_TOKEN' }), …)
 *
 * ★ ONE CALL PER INSTANCE. A stack declaring resources against both `grafana.homeflare.dev` and
 *   `teslamate-grafana` composes `grafanaProviders(targetA)` and `grafanaProviders(targetB)` —
 *   each resource type's `Resource` constructor is a single global registration, so the SAME
 *   `Grafana.Datasource` type serves both; only the credential layer differs per call.
 * ⚠️ `HttpClient` is NOT provided here. It is ambient in every Alchemy runtime, the same as
 *   `litellmProviders`/`netboxProviders`-style families in this kit assume; a stack that already
 *   deploys anything over HTTP already has one.
 */
import * as Layer from 'effect/Layer';
import { type GrafanaTarget, grafanaCredentials } from './credentials.ts';
import { GrafanaDashboardProvider } from './dashboard.ts';
import { GrafanaDatasourceProvider } from './datasource.ts';
import { GrafanaFolderProvider } from './folder.ts';

export const grafanaProviders = (target: GrafanaTarget) =>
  Layer.mergeAll(
    GrafanaDatasourceProvider(),
    GrafanaFolderProvider(),
    GrafanaDashboardProvider(),
  ).pipe(Layer.provide(grafanaCredentials(target)));
