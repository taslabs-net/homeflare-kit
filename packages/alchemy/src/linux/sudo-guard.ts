/**
 * The checks sudo-runner.ts makes against the host, as the operator, before it runs a file or
 * directory operation as root. sudo-allowlist.ts checks the argv; this checks what the paths in
 * it actually are — the Linux twin of `../launchd/sudo-guard.ts`, rebuilt on `sudo-listing.ts`'s
 * ONE `ls -ldn` call instead of an lstat per directory, because ssh pays a handshake per call
 * (ssh-runner.ts: no multiplexing unless the caller opts in) where a local syscall pays nothing.
 *
 * ⛔ EVERY DIRECTORY FROM `/` DOWN TO THE FILE MUST BE ROOT'S ALONE, for the same reason the Mac
 *   guard insists on it: a directory anyone else may write lets them swap what lies under it — a
 *   symlink where the file was — between this read and the privileged call. A root-owned symlink
 *   ABOVE the prefix (Debian's merged-`/usr`, `/lib` -> `usr/lib`) is the system's own and is
 *   followed, exactly as `aboveDirs`/`betweenDirs` from the Mac guard already encode; a symlink AT
 *   or BELOW the prefix is refused outright — a write should never chase one there.
 * ⛔ THE ACL SIGNAL IS THE `+` FLAG ALONE (sudo-listing.ts header): `ls`, not `getfacl`, which is
 *   absent on the estate's Debian hosts. A directory that carries one is refused whatever it
 *   grants — the guard cannot tell a read-only entry from a write one, so it fails closed.
 */
import type { FileStat, HostRunner, WriteOptions } from '../launchd/runner.ts';
import {
  aboveDirs,
  assertReadableBack,
  betweenDirs,
  canRead,
  modeProblem,
  operatorGroups,
} from '../launchd/sudo-guard.ts';
import { SudoRefusedError } from './sudo-allowlist.ts';
import { type Listed, readListing } from './sudo-listing.ts';

export { aboveDirs, assertReadableBack, betweenDirs, canRead, modeProblem, operatorGroups };

const refuse = (path: string, message: string): Error =>
  new SudoRefusedError(`sshSudoRunner ${path}: ${message}`);

const rootOnlyProblem = (entry: Listed | undefined): string | undefined => {
  if (entry === undefined) return 'is missing';
  if (entry.kind !== 'directory') return `is a ${entry.kind}, not a directory`;
  if (entry.uid !== 0) return `is owned by uid ${String(entry.uid)}, not root`;
  if ((entry.mode & 0o022) !== 0) {
    return `is writable by group or other (mode ${entry.mode.toString(8).padStart(4, '0')})`;
  }
  if (entry.acl) return 'carries a POSIX ACL this runner cannot verify the grants of (ls -ldn `+`)';
  return undefined;
};

/** What must be at `path` itself, for the operation about to run there. */
export type ChainExpect = 'file' | 'file-or-absent' | 'directory' | 'absent';

/**
 * ⚠️ NOT PART OF THE `ls -ldn` BATCH, on purpose — mirroring the Mac guard's own
 *   `assertPlainPath`, whose ACL check also excludes `path` itself (`assertNoAclGrants(base,
 *   path, [...above, prefix, ...dirs])`, never `path` in that list). `readListing`'s
 *   `parseListing` requires every requested path to have a line (sudo-listing.ts), so a target
 *   that is legitimately ABSENT — the common case for a create — would make the whole batched
 *   read look unparseable if it were included. A plain `stat` handles "nothing there" correctly.
 */
const targetProblem = (entry: FileStat | undefined, expect: ChainExpect): string | undefined => {
  if (expect === 'absent')
    return entry === undefined ? undefined : `already exists (a ${entry.kind})`;
  if (entry === undefined) return expect === 'file-or-absent' ? undefined : 'is missing';
  if (expect === 'file-or-absent')
    return entry.kind === 'file' ? undefined : `is a ${entry.kind}, not a file`;
  return entry.kind === expect ? undefined : `is a ${entry.kind}, not a ${expect}`;
};

/**
 * Refuse a prefix that is not root-only, a symlink or wrong kind between the prefix and `path`,
 * an ACL anywhere in the chain, or a target that is not what `expect` says. ONE `ls -ldn` for the
 * directory chain, plus one plain `stat` for the target (see `targetProblem`'s note on why they
 * are separate calls). ⚠️ Reads only, as the operator — so `checkWrite` runs this at plan time too.
 */
export const assertGuardedChain = async (
  base: HostRunner,
  prefix: string,
  path: string,
  expect: ChainExpect,
): Promise<FileStat | undefined> => {
  const above = aboveDirs(prefix);
  const between = betweenDirs(prefix, path);
  const chain = [...above, prefix, ...between];
  const listed = await readListing(base, '/usr/bin/ls', path, chain);
  for (const dir of above) {
    const entry = listed.get(dir);
    // ★ A root-owned symlink ABOVE the prefix is the system's own and is followed, as every path
    //   lookup does; a symlink anywhere else in the chain is refused by rootOnlyProblem below.
    const problem =
      entry?.kind === 'symlink' && entry.uid === 0 ? undefined : rootOnlyProblem(entry);
    if (problem !== undefined) {
      throw refuse(
        path,
        `${dir}, above the declared prefix ${prefix}, ${problem}. Whoever may change it may swap ` +
          'the prefix itself; every directory from / down must be root-only. Nothing ran as root.',
      );
    }
  }
  const prefixProblem = rootOnlyProblem(listed.get(prefix));
  if (prefixProblem !== undefined) {
    throw refuse(
      path,
      `the declared prefix ${prefix} ${prefixProblem}. Declare only a real directory that root ` +
        'owns and only root may write. Nothing ran as root.',
    );
  }
  for (const dir of between) {
    const problem = rootOnlyProblem(listed.get(dir));
    if (problem !== undefined) {
      throw refuse(
        path,
        `${dir} ${problem}. Every directory from the prefix ${prefix} down to the file must be ` +
          'one that root owns and only root may write. Nothing ran as root.',
      );
    }
  }
  const target = await base.stat(path);
  const problem = targetProblem(target, expect);
  if (problem !== undefined) throw refuse(path, `${problem}. Nothing ran as root.`);
  return target;
};

/**
 * The mode/owner and read-back checks for a file write under `prefix`, plus the path chain.
 * ★ Reads only, as the operator — the same checks run at plan time (`checkWrite`) and before the
 *   install/mv pair. `expect` is `'file-or-absent'`: a write may create or replace.
 */
export const assertInstallable = async (
  base: HostRunner,
  prefix: string,
  path: string,
  options: WriteOptions,
  groups: readonly number[] | undefined,
): Promise<void> => {
  const mode = modeProblem(options);
  if (mode !== undefined) {
    throw refuse(
      path,
      `${mode}. Declare a mode without those bits (0644, 0640, 0755), or give the file to its ` +
        'real owner. Nothing ran as root.',
    );
  }
  await assertGuardedChain(base, prefix, path, 'file-or-absent');
  await assertReadableBack(base, path, options, groups);
};
