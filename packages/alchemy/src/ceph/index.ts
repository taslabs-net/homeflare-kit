/**
 * Ceph providers for Alchemy — the mon-command transport and `Ceph.AuthEntity` (K-A4).
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, DELIBERATELY SMALLER THAN THE DIRECTORY — see
 *   `../openbao/index.ts`'s header for why. The allowlist internals (ceph-argv.ts), the parsing
 *   (ceph-auth-parse.ts) and the reconcile loop (ceph-auth-reconcile.ts) are exported by path for
 *   a future `CephConfigOption` (K-D) or a test to reach directly, not published here.
 */
export type { CephAuthEntityAttributes, CephAuthEntityProps, CephCaps } from './auth-entity.ts';
export { CephAuthEntity, CephAuthEntityProvider } from './auth-entity.ts';
export type { CephDial, CephExecResult, CephTransportOptions } from './ceph-transport.ts';
export { assertFreshQuorum, runCephCommand, sshCephDial } from './ceph-transport.ts';
