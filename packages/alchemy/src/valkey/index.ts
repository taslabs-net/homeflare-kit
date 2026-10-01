/**
 * Valkey providers for Alchemy — `Valkey.Instance` (assert-and-read a running server) and
 * `Valkey.AclFile` (per-seat ACL users, key-prefix limited, passwords by reference). See
 * `docs/valkey.md`.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, deliberately smaller than the directory: `fake-valkey.ts`,
 *   `transport.ts` and the form internals are test doubles and internals, not something a
 *   consuming stack should import (the same rule `postgres/index.ts` and `netbox/index.ts` use).
 */
export type {
  ValkeyAclFileAttributes,
  ValkeyAclFileProps,
  ValkeyAclProfile,
  ValkeyAclUser,
  ValkeyAclUserAttributes,
} from './acl-attrs.ts';
export { ValkeyAclFile, ValkeyAclFileProvider, isValkeyAclFile } from './acl.ts';
export type { ValkeyConnectionConfig } from './connection.ts';
export {
  ValkeyConnection,
  ValkeyConnectionMissing,
  valkeyConnection,
  withValkey,
} from './connection.ts';
export {
  ValkeyAclChannelPatterns,
  ValkeyAclFileRendered,
  ValkeyAclMonitorKeyPrefix,
  ValkeyAclNameGlob,
  ValkeyAclPasswordMissing,
  ValkeyAclParseError,
  ValkeyAclReadbackFailed,
  ValkeyAclReservedUser,
  ValkeyAclSeatKeyPrefix,
  ValkeyAclUserNameMismatch,
  ValkeyAuthPasswordMissing,
  ValkeyInstanceDrift,
  ValkeyInstanceUnreachable,
  type ValkeyError,
} from './errors.ts';
export type {
  ValkeyInstanceAttributes,
  ValkeyInstanceConfig,
  ValkeyInstanceInfo,
  ValkeyInstanceProps,
} from './instance-attrs.ts';
export {
  ValkeyInstance,
  ValkeyInstanceDeleteRefused,
  ValkeyInstanceProvider,
  isValkeyInstance,
  type ValkeyInstanceError,
} from './instance.ts';
export { valkeyProviders } from './providers.ts';
