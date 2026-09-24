/**
 * Caddy for Alchemy — a running Caddy's config, declared as Caddyfile text and applied through
 * Caddy's own admin API (`POST /load`, `GET /config/`).
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, AND IT IS DELIBERATELY SMALLER THAN THE DIRECTORY. The lifecycle,
 *   the digest, the guards and the admin calls are internals; an `export *` would publish them.
 * ⛔ THE ADMIN API STAYS ON LOOPBACK OR A UNIX SOCKET. It has no authentication; localCaddyAdmin()
 *   refuses any other address, and a Caddyfile that would move or expose it is refused before load.
 * ⛔ NOTHING IS ADOPTED SILENTLY: a running config that is not the declared one needs `--adopt`.
 * Guide, order of file and load, adoption, `--resume` and secrets: docs/caddy.md.
 */
/**
 * ★ `accessForwardAuth` is Caddyfile TEXT, not a resource: it renders the `forward_auth` block
 *   that puts a Cloudflare Access check in front of a route, paired with the verifier in
 *   `@homeflare/cloudflare/access-auth`. Guide: docs/access-auth.md.
 */
export {
  accessForwardAuth,
  verifierProblems,
  type AccessForwardAuthProps,
} from './access-forward-auth.ts';
export type { CaddyAdminListener, CaddyTarget, CaddyTransport } from './admin.ts';
export { CaddyAdminService, caddyAdminLayer } from './admin.ts';
export { isUnreachable } from './caddy-http-client.ts';
export type { CaddyConfigAttributes, CaddyConfigProps } from './config.ts';
export { CaddyConfig, CaddyConfigProvider } from './config.ts';
export {
  CaddyFmtFailed,
  CaddyFmtNotFound,
  DEFAULT_CADDY_BINARY,
  formatCaddyfile,
  type FormatCaddyfileOptions,
} from './format.ts';
export type { LocalCaddyAdminOptions } from './local-admin.ts';
export { DEFAULT_ADMIN_ADDRESS, localCaddyAdmin } from './local-admin.ts';
export { caddyProviders } from './providers.ts';
export type { CaddyWithFileProps } from './with-file.ts';
export { caddyWithFile } from './with-file.ts';
