/**
 * The Caddy provider with its admin transport, as a single layer for a host stack.
 *
 *     Layer.mergeAll(caddyProviders(), launchdProviders(), …the stack's other providers)
 *
 * ★ launchdProviders() TOO when the stack uses caddyWithFile(): the file is a launchd-subpath
 *   HostFile, written through that subpath's HostRunner.
 * ⚠️ The default is localCaddyAdmin(): `http://127.0.0.1:2019`, Caddy's default admin listener.
 *   Pass another CaddyAdmin for a unix socket, a narrowed `admin { origins }`, or an SSH forward.
 */
import * as Layer from 'effect/Layer';
import { type CaddyAdmin, caddyAdminLayer } from './admin.ts';
import { CaddyConfigProvider } from './config.ts';
import { localCaddyAdmin } from './local-admin.ts';

export const caddyProviders = (admin: CaddyAdmin = localCaddyAdmin()) =>
  CaddyConfigProvider().pipe(Layer.provide(caddyAdminLayer(admin)));
