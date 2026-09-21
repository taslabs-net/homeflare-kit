/**
 * The one seam between the Caddy provider and a running Caddy: every call to Caddy's admin API goes
 * through a CaddyAdmin, and nothing in this directory reaches Caddy any other way.
 *
 * ★ CADDY's OWN MANAGEMENT API, NOT A FILE AND A SIGNAL. Decision 23 (vault consolidation plan,
 *   2026-09-21): `POST /load` applies a Caddyfile with a graceful reload and rolls back a config
 *   Caddy refuses; `GET /config/` reports what is running. Read in caddyserver/caddy v2.11.4,
 *   caddyconfig/load.go and admin.go, and in the API docs (caddyserver.com/docs/api).
 * ★ A SEAM, THE SAME SHAPE AS launchd's HostRunner, so the lifecycle runs against a fake admin
 *   server in tests and a consumer can plug in another route to the API (an SSH-forwarded socket
 *   today; a remote runner later) without touching the provider. PROMISES, NOT EFFECTS, for the
 *   same reason as HostRunner: a consumer writing their own implements plain async functions.
 * ⛔ THE ADMIN API HAS NO AUTHENTICATION. Anyone who reaches it can replace every site. It stays on
 *   loopback or a unix socket; localCaddyAdmin() refuses anything else (local-admin.ts).
 */
import * as Context from 'effect/Context';
import * as Layer from 'effect/Layer';

/** One admin API exchange. ⛔ `body` may hold the running config — never log it whole. */
export type CaddyAdminResponse = {
  readonly status: number;
  readonly body: string;
};

export type CaddyAdminRequest = {
  readonly method: 'GET' | 'POST';
  /** Absolute API path: `/load`, `/adapt`, `/config/`. */
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
};

/**
 * Where the admin listener is, in the terms Caddy's own `admin` option uses — so a Caddyfile that
 * would move the listener away from where the provider talks to it can be refused (admin-guard.ts).
 */
export type CaddyAdminListener =
  | { readonly kind: 'tcp'; readonly hostHeader: string; readonly port: number }
  | { readonly kind: 'unix'; readonly path: string };

export interface CaddyAdmin {
  /** Where requests go, for error messages and the resource's attributes. Never a credential. */
  readonly endpoint: string;
  /**
   * The listener as Caddy sees it. `hostHeader` is the Host every request carries: Caddy checks it
   * against `admin.origins` (admin.go checkHost) on any loopback TCP listener.
   */
  readonly listener: CaddyAdminListener;
  /**
   * Send one request. Resolves with ANY status — classifying it is the caller's job
   * (admin-calls.ts). Rejects only when there was no HTTP exchange at all: with a
   * CaddyUnreachableError when nothing accepted the connection, any other Error otherwise.
   */
  request(request: CaddyAdminRequest): Promise<CaddyAdminResponse>;
}

/**
 * Nothing accepted the connection — Caddy is not running, or not listening yet. A transport rejects
 * with THIS only when the request provably never reached Caddy (refused, no socket file), because
 * the provider treats it differently from every other failure: a stopped Caddy must not fail the
 * PLAN that would bring it back (its launchd job in the same stack) — see config.ts.
 */
export class CaddyUnreachableError extends Error {
  override readonly name = 'CaddyUnreachableError';
}

/** The Effect service the Caddy provider reads its admin transport from. */
export class CaddyAdminService extends Context.Service<CaddyAdminService, CaddyAdmin>()(
  'homeflare/caddy/CaddyAdmin',
) {}

/** Provide a transport to the provider: `Layer.provide(caddyAdminLayer(localCaddyAdmin()))`. */
export const caddyAdminLayer = (admin: CaddyAdmin): Layer.Layer<CaddyAdminService> =>
  Layer.succeed(CaddyAdminService, admin);
