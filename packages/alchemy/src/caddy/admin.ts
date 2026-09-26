/**
 * The one seam between the Caddy provider and a running Caddy: every operation goes through
 * `@distilled.cloud/caddy`'s typed `Services.admin.*` calls (admin-calls.ts), over the
 * `CaddyAdminService` metadata and the `Credentials` + `HttpClient` layers `localCaddyAdmin()`
 * builds (local-admin.ts) — nothing in this directory reaches Caddy any other way.
 *
 * ★ CADDY's OWN MANAGEMENT API, NOT A FILE AND A SIGNAL. Decision 23 (vault consolidation plan,
 *   2026-09-21): `POST /load` applies a Caddyfile with a graceful reload and rolls back a config
 *   Caddy refuses; `GET /config/` reports what is running. Read in caddyserver/caddy v2.11.4,
 *   caddyconfig/load.go and admin.go, and in the API docs (caddyserver.com/docs/api).
 * ★ `CaddyAdminService` CARRIES ONLY MESSAGE/GUARD METADATA (endpoint, listener) — never a
 *   credential, and never the transport itself. The transport is `@distilled.cloud/caddy`'s own
 *   `Credentials` and `HttpClient.HttpClient` services — admin-calls.ts calls the SDK's operations
 *   directly rather than through a house-specific `.request()` seam. A consumer plugs in another
 *   route to the API (an SSH-forwarded socket today; a remote runner later) by providing a different
 *   `CaddyTransport` to `caddyAdminLayer`.
 * ⛔ THE ADMIN API HAS NO AUTHENTICATION. Anyone who reaches it can replace every site. It stays on
 *   loopback or a unix socket; localCaddyAdmin() refuses anything else (local-admin.ts).
 * ⛔ `caddyAdminLayer`'s OWN OUTPUT NEVER CARRIES `Credentials`/`HttpClient.HttpClient` DIRECTLY —
 *   MEASURED 2026-09-26: it used to (`Layer.mergeAll(CaddyAdminService-layer, transport.layer)`,
 *   what `caddyProviders()` then `provideMerge`d into a stack), and a stack that applies its own
 *   ambient client OUTSIDE the providers' merge — `Layer.mergeAll(providers…).pipe(Layer.provide
 *   (ambient))`, the shape `argocd`/`discord`/`opnsense`/`unifi`'s own `providers.ts` document —
 *   never got it back: `Layer.provide(A, B)`'s result outputs only `A`'s own services, so once `A`
 *   (the merged providers) already carries `HttpClient.HttpClient` from Caddy, no outer `B` overrides
 *   it. Every OTHER fetch-based provider merged alongside `caddyProviders()` (homeflare-mini's
 *   Forgejo, LiteLLM) then dialled Caddy's admin API instead of its own target — reproduced in
 *   admin-transport-scope.test.ts. `caddyAdminLayer` now stores `transport.layer` itself as a plain
 *   VALUE, under `CaddyAdminTransport` — a house-only tag nothing outside caddy/ ever reads — and
 *   config.ts is the one place that `Effect.provide`s it, scoped to exactly the effects that call
 *   `@distilled.cloud/caddy`'s operations.
 */
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import * as Context from 'effect/Context';
import * as Layer from 'effect/Layer';
import type { Credentials } from '@distilled.cloud/caddy';

/**
 * Where the admin listener is, in the terms Caddy's own `admin` option uses — so a Caddyfile that
 * would move the listener away from where the provider talks to it can be refused (admin-guard.ts).
 */
export type CaddyAdminListener =
  | { readonly kind: 'tcp'; readonly hostHeader: string; readonly port: number }
  | { readonly kind: 'unix'; readonly path: string };

/** Message/guard metadata for the Caddy this stack talks to — never a credential. */
export interface CaddyTarget {
  /** Where requests go, for error messages and the resource's attributes. */
  readonly endpoint: string;
  /**
   * The listener as Caddy sees it. `hostHeader` is the Host every request carries: Caddy checks it
   * against `admin.origins` (admin.go checkHost) on any loopback TCP listener.
   */
  readonly listener: CaddyAdminListener;
}

/** What `localCaddyAdmin()` (or a consumer's own transport) hands `caddyAdminLayer`. */
export interface CaddyTransport extends CaddyTarget {
  /**
   * Provides the SDK's own `Credentials` and `HttpClient.HttpClient` — see local-admin.ts.
   * ⚠️ BUILT AND TORN DOWN ON EVERY `read`/`diff`/`reconcile` CALL — config.ts's `Effect.provide
   *   (transportLayer)` runs fresh each time, scoped to that one call (the scoping fix this file's
   *   own ⛔ documents). `localCaddyAdmin()`'s layer is three plain `Layer.succeed` values, so this
   *   costs nothing; a transport that opens something stateful (an SSH forward, a connection pool)
   *   would open and close it per call instead of once per stack. No such transport exists in the
   *   tray today (2026-09-26) — keep `layer` cheap and stateless, or build once and hand config.ts a
   *   pre-built `Context` instead, if that changes.
   */
  readonly layer: Layer.Layer<Credentials | HttpClient.HttpClient>;
}

/** The Effect service the Caddy provider reads its admin target's metadata from. */
export class CaddyAdminService extends Context.Service<CaddyAdminService, CaddyTarget>()(
  'homeflare/caddy/CaddyAdmin',
) {}

/**
 * `transport.layer` ITSELF, carried as a plain value rather than merged into the ambient context —
 * the scoping fix (see the file header's ⛔). Only config.ts reads this tag, and only to
 * `Effect.provide` it locally around the handful of effects that actually call
 * `@distilled.cloud/caddy`'s operations; nothing else in this directory, and nothing outside it,
 * has a reason to.
 */
export class CaddyAdminTransport extends Context.Service<
  CaddyAdminTransport,
  Layer.Layer<Credentials | HttpClient.HttpClient>
>()('homeflare/caddy/CaddyAdminTransport') {}

/**
 * Provide a transport to the provider: `CaddyConfigProvider().pipe(Layer.provideMerge(caddyAdminLayer(localCaddyAdmin())))`
 * — never plain `Layer.provide` here (see providers.ts's own ⚠️): `CaddyConfigProvider()`'s handlers
 * keep needing `CaddyAdminService`/`CaddyAdminTransport` every time the engine calls them, not just
 * once while it is built. Neither tag is a generic platform service, so merging them into a stack's
 * ambient context (unlike the raw `Credentials`/`HttpClient.HttpClient` this used to carry — the
 * file header's ⛔) is safe: nothing outside this directory looks either up.
 */
export const caddyAdminLayer = (
  transport: CaddyTransport,
): Layer.Layer<CaddyAdminService | CaddyAdminTransport> =>
  Layer.mergeAll(
    Layer.succeed(CaddyAdminService, {
      endpoint: transport.endpoint,
      listener: transport.listener,
    }),
    Layer.succeed(CaddyAdminTransport, transport.layer),
  );
