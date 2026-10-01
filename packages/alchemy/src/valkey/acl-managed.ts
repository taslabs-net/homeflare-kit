/** Observed users are not ownership: remember the declaration independently of ACL LIST. */
import type { ValkeyAclFileAttributes, ValkeyAclFileProps } from './acl-attrs.ts';

export const managedUserNames = (
  stored: ValkeyAclFileAttributes | undefined,
  previous?: ValkeyAclFileProps,
): ReadonlyArray<string> =>
  stored?.managedUsers ??
  // Compatibility with state written before managedUsers existed: the prior declaration is
  // authoritative. Executor-only callers can identify users we wrote by their stored seals.
  (previous === undefined
    ? Object.keys(stored?.users ?? {}).filter((name) => stored?.users[name]?.passwordSeal !== '')
    : Object.keys(previous.users));
