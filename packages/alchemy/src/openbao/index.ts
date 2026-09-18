/**
 * OpenBao providers for Alchemy.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, AND IT IS DELIBERATELY SMALLER THAN THE DIRECTORY.
 *   These are the symbols a real stack consumes; the rest of the files are internals a
 *   provider needs but a consumer should not depend on. An `export *` here would publish
 *   every helper as API and make the next refactor a breaking change.
 * ★ Anything unlisted is still reachable by path if you genuinely need it — that is a
 *   deliberate, visible act rather than an accident of barrelling.
 */
export { BaoAuthRole, BaoAuthRoleProvider } from './auth-role.ts';
export { BaoCloudflareRole, BaoCloudflareRoleProvider } from './cloudflare-role.ts';
export {
  CloudflarePermissionGroups,
  permissionGroupsFromEngine,
  permissionGroupsFromLiveRoles,
} from './cloudflare-permission-groups.ts';
export type { CloudflareZone, ExpandedRole } from './cloudflare-roles-expand.ts';
export { expandAccount, expandAll, mountName } from './cloudflare-roles-expand.ts';
export type { RolesConfig, SurfaceSpec } from './cloudflare-roles-config.ts';
export { parseRolesConfig } from './cloudflare-roles-config.ts';
export { BaoMount, BaoMountProvider } from './mount.ts';
export { BaoPkiRole, BaoPkiRoleProvider } from './pki-role.ts';
export { BaoPolicy, BaoPolicyProvider } from './policy.ts';
export { BaoProxmoxRole, BaoProxmoxRoleProvider } from './proxmox-role.ts';
export { BaoSshRoleProvider } from './ssh-role.ts';
