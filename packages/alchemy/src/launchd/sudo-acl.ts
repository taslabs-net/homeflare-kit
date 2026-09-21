/**
 * The ACL half of sudo-guard.ts: mode bits say a directory is root's alone, and an ACL can say
 * otherwise. On macOS an `allow add_file,add_subdirectory,delete_child` entry lets its holder swap
 * what lies under a root-owned `0755` directory — a symlink where the file was — between the
 * guard's lstat checks and the privileged call, exactly as group write would. An inheritable
 * `allow write` hands every file root installs there to its holder.
 *
 * ★ READ WITH `ls -lden`, AS THE OPERATOR — no sudo, and the same read at plan time and before the
 *   write. MEASURED 2026-09-21 on macOS 27.2: each entry prints on its own line after the path's,
 *   as ` 0: <qualifier> [inherited ]allow|deny <perms>`; `-n` makes the qualifier a UUID, never a
 *   name with a space in it. The `+` flag after the mode is NOT reliable — `@` (extended
 *   attributes) replaces it in the listing — so the entries are what is read.
 * ⚠️ A DENY ENTRY GRANTS NOTHING (macOS puts `everyone deny delete` on home folders), and an allow
 *   of read-only rights (`list`, `search`, `readattr` …) swaps nothing, so neither refuses.
 */
import type { HostRunner } from './runner.ts';
import { SudoRefusedError } from './sudo-allowlist.ts';

export const LS = '/bin/ls';

/** Rights that let the holder add, remove, rename or re-permission what a directory holds. */
const WRITE_RIGHTS: ReadonlySet<string> = new Set([
  'add_file',
  'add_subdirectory',
  'append',
  'chown',
  'delete',
  'delete_child',
  'write',
  'writesecurity',
]);

const ENTRY = /^\s*\d+:\s+\S+\s+(?:inherited\s+)?allow\s+(\S+)/;

/** The allow entries in `ls -lden` output that grant a write right, as printed. */
export const aclGrants = (listing: string): string[] =>
  listing
    .split('\n')
    .filter((line) => {
      const rights = ENTRY.exec(line)?.[1];
      return rights !== undefined && rights.split(',').some((right) => WRITE_RIGHTS.has(right));
    })
    .map((line) => line.trim());

/**
 * ⛔ Refuse when any directory in `chain` carries an ACL entry that lets someone write it, or when
 *   the ACLs cannot be read at all (fail closed). `path` names the file in the refusal.
 */
export const assertNoAclGrants = async (
  base: HostRunner,
  path: string,
  chain: readonly string[],
): Promise<void> => {
  const listed = await base.exec([LS, '-lden', '--', ...chain]);
  if (listed.exitCode !== 0) {
    throw new SudoRefusedError(
      `sudoRunner ${path}: could not read the ACLs of the directories from / down to it ` +
        `(${LS} -lden exit ${String(listed.exitCode)}). Nothing ran as root.`,
    );
  }
  const grants = aclGrants(listed.stdout);
  if (grants.length === 0) return;
  throw new SudoRefusedError(
    `sudoRunner ${path}: a directory from / down to it carries an ACL that lets someone other ` +
      `than root change what it holds (${grants.join('; ')}). Remove the entry (chmod -a), or ` +
      'declare a prefix without one. Nothing ran as root.',
  );
};
