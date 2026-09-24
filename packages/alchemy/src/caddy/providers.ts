/**
 * The Caddy provider with its admin transport, as a single layer for a host stack.
 *
 *     Layer.mergeAll(caddyProviders(), launchdProviders(), …the stack's other providers)
 *
 * ★ launchdProviders() TOO when the stack uses caddyWithFile(): the file is a launchd-subpath
 *   HostFile, written through that subpath's HostRunner.
 * ⚠️ The default is localCaddyAdmin(): `http://127.0.0.1:2019`, Caddy's default admin listener.
 *   Pass another CaddyTransport for a unix socket, a narrowed `admin { origins }`, or an SSH
 *   forward — `localCaddyAdmin({ address, hostHeader })` builds one; a consumer can provide any
 *   other `{ endpoint, listener, layer }` reaching `@distilled.cloud/caddy`'s own `Credentials`
 *   and `HttpClient.HttpClient`.
 *
 * ⚠️ `Layer.provideMerge`, NEVER PLAIN `Layer.provide`, for `caddyAdminLayer`. `CaddyConfigProvider()`'s
 *   `read`/`diff`/`reconcile` handlers each still need `CaddyAdminService` and
 *   `@distilled.cloud/caddy`'s `Credentials`/`HttpClient` — Alchemy's own `Provider.effect` types
 *   those as part of the LAYER's overall requirement (`ProviderService`'s per-handler `Req` type
 *   parameters, `alchemy/Provider.ts`), for exactly this reason. Plain `Layer.provide` SEALS a
 *   layer — it satisfies `CaddyConfigProvider()`'s requirement only for BUILDING the `Provider`
 *   value (the `admin` in its outer `Effect.gen`), then hides those services from anything that
 *   runs LATER, when the returned `read`/`diff`/`reconcile` FUNCTIONS actually execute. MEASURED
 *   2026-09-23: with plain `Layer.provide`, `caddyProviders()`'s own `reconcile` handler dies with
 *   "Service not found: homeflare/caddy/CaddyAdmin" the moment the ENGINE calls it. `provideMerge`
 *   feeds `caddyAdminLayer`'s output into `CaddyConfigProvider()`'s requirement AND keeps that same
 *   output live in the result, so every later handler call still runs with it in context.
 */
import * as Layer from 'effect/Layer';
import { type CaddyTransport, caddyAdminLayer } from './admin.ts';
import { CaddyConfigProvider } from './config.ts';
import { localCaddyAdmin } from './local-admin.ts';

export const caddyProviders = (transport: CaddyTransport = localCaddyAdmin()) =>
  CaddyConfigProvider().pipe(Layer.provideMerge(caddyAdminLayer(transport)));
