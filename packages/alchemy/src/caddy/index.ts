/**
 * Caddy for Alchemy — a running Caddy's config, declared as Caddyfile text and applied through
 * Caddy's own admin API (`POST /load`, `GET /config/`).
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, AND IT IS DELIBERATELY SMALLER THAN THE DIRECTORY. The lifecycle,
 *   the digest, the guards and the admin calls are internals; an `export *` would publish them.
 * ⛔ THE ADMIN API STAYS ON LOOPBACK OR A UNIX SOCKET. It has no authentication; localCaddyAdmin()
 *   refuses any other address, and a Caddyfile that would move or expose it is refused before load.
 * Guide, order of file and load, `--resume` and secrets: docs/caddy.md.
 */
export type {
  CaddyAdmin,
  CaddyAdminListener,
  CaddyAdminRequest,
  CaddyAdminResponse,
} from './admin.ts';
export { CaddyAdminService, CaddyUnreachableError, caddyAdminLayer } from './admin.ts';
export { CaddyAdminError } from './admin-calls.ts';
export type { CaddyConfigAttributes, CaddyConfigProps } from './config.ts';
export { CaddyConfig, CaddyConfigProvider } from './config.ts';
export type { LocalCaddyAdminOptions } from './local-admin.ts';
export { DEFAULT_ADMIN_ADDRESS, localCaddyAdmin } from './local-admin.ts';
export { caddyProviders } from './providers.ts';
export type { CaddyWithFileProps } from './with-file.ts';
export { caddyWithFile } from './with-file.ts';
