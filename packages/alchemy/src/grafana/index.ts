/**
 * Grafana providers for Alchemy.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, AND IT IS DELIBERATELY SMALLER THAN THE DIRECTORY. These are
 *   the symbols a real stack consumes; the rest of the files (resource.ts's engine, fake-grafana.ts)
 *   are internals a provider needs but a consumer should not depend on.
 *
 * ⛔ ONLY `Grafana.Datasource` SHIPS HERE. `@distilled.cloud/grafana@1.0.0-rc.12` has no folder,
 *   dashboard, alert-rule or contact-point CRUD operations — see docs/grafana.md and
 *   docs/upstream-conformance.md for the measured gap. Adding those resources now would mean
 *   hand-rolling an `HttpClient` client for them, which S23 forbids for a vendor distilled
 *   already covers in part; the right fix is upstream, in distilled, not a house workaround here.
 */
export {
  type DatasourceAttributes,
  type DatasourceProps,
  GrafanaDatasource,
  GrafanaDatasourceProvider,
  GrafanaSecretRefUnsetError,
} from './datasource.ts';
export { type GrafanaTarget, grafanaCredentials } from './credentials.ts';
export { grafanaProviders } from './providers.ts';
