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
 *   `Credentials` and `HttpClient.HttpClient` services, provided alongside it by `caddyAdminLayer`,
 *   so admin-calls.ts calls the SDK's operations directly rather than through a house-specific
 *   `.request()` seam. A consumer plugs in another route to the API (an SSH-forwarded socket today;
 *   a remote runner later) by providing a different `CaddyTransport` to `caddyAdminLayer`.
 * ⛔ THE ADMIN API HAS NO AUTHENTICATION. Anyone who reaches it can replace every site. It stays on
 *   loopback or a unix socket; localCaddyAdmin() refuses anything else (local-admin.ts).
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
  /** Provides the SDK's own `Credentials` and `HttpClient.HttpClient` — see local-admin.ts. */
  readonly layer: Layer.Layer<Credentials | HttpClient.HttpClient>;
}

/** The Effect service the Caddy provider reads its admin target's metadata from. */
export class CaddyAdminService extends Context.Service<CaddyAdminService, CaddyTarget>()(
  'homeflare/caddy/CaddyAdmin',
) {}

/**
 * Provide a transport to the provider: `CaddyConfigProvider().pipe(Layer.provideMerge(caddyAdminLayer(localCaddyAdmin())))`
 * — never plain `Layer.provide` here (see providers.ts's own ⚠️): `CaddyConfigProvider()`'s handlers
 * keep needing these services every time the engine calls them, not just once while it is built. Merges
 * the target metadata with the SDK's `Credentials`/`HttpClient` layers `transport.layer` carries.
 */
export const caddyAdminLayer = (
  transport: CaddyTransport,
): Layer.Layer<CaddyAdminService | Credentials | HttpClient.HttpClient> =>
  Layer.mergeAll(
    Layer.succeed(CaddyAdminService, {
      endpoint: transport.endpoint,
      listener: transport.listener,
    }),
    transport.layer,
  );
