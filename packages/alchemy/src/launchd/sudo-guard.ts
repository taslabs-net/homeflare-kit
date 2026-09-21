/**
 * The checks sudo-runner.ts makes against the host, as the deploying user, before it runs anything
 * as root. sudo-allowlist.ts checks the argv; this checks what the paths in it actually are.
 *
 * ⛔ WHAT IS LOGGED IS WHAT IS WRITTEN. A symlinked directory under a prefix would make
 *   `install` or `rm`, running as root, act on a path the log never named. So every directory
 *   between the prefix and the file must be a real directory.
 * ⛔ EVERY DIRECTORY FROM THE PREFIX DOWN IS ROOT'S ALONE (decided 2026-09-21). A directory below
 *   the prefix that another user owns, or that group or other may write, lets that user swap what
 *   lies under it — a symlink where the file was — between these checks and the privileged call.
 *   So each one must be owned by root and not group/other-writable (rootOnlyProblem), exactly as
 *   the prefix itself must.
 * ⚠️ These checks run before the privileged call, as the deploying user. They guard against a
 *   mistaken declaration and against every user but root; root itself could still change a path
 *   in that window, and ACLs are not read.
 */
import type { FileStat, HostRunner, WriteOptions } from './runner.ts';
import { SudoRefusedError } from './sudo-allowlist.ts';

const refuse = (path: string, message: string): Error =>
  new SudoRefusedError(`sudoRunner ${path}: ${message}`);

/** The directories strictly between `prefix` and the file at `path`. */
export const betweenDirs = (prefix: string, path: string): string[] => {
  const parts = path
    .slice(prefix.length + 1)
    .split('/')
    .slice(0, -1);
  return parts.map((_, index) => `${prefix}/${parts.slice(0, index + 1).join('/')}`);
};

/**
 * What must be at `path` itself: a regular file, or (for a write or a remove) nothing yet.
 * ⚠️ A DIRECTORY AT THE DESTINATION IS THE TRAP: `install src dir` copies INTO the directory
 *   (install(1)), and install decides that with stat, so a symlink to a directory does the same.
 */
export type Expect = 'file' | 'file-or-absent';

/**
 * ⛔ THE PREFIX, AND EVERY DIRECTORY BELOW IT ON THE WAY TO THE FILE, MUST BE A DIRECTORY ONLY ROOT
 *   CAN CHANGE, checked at every call rather than trusted from the declaration. A symlinked prefix makes root write wherever it points, which the
 *   log never names (`/opt/example` -> `/etc` turns a HostFile at `/opt/example/sudoers` into
 *   `/etc/sudoers`). A prefix another user owns or may write lets that user swap a directory below
 *   it for a symlink between this check and the privileged call.
 * ⚠️ lstat of the prefix itself: a symlink ABOVE it (`/etc` -> `/private/etc` on macOS) is the
 *   system's and is followed, as every path lookup does. ACLs are not read; mode bits only.
 * ★ MEASURED 2026-09-21 on macOS 27.2 (`ls -ldn`): /Library/LaunchDaemons, /private/etc, /opt and
 *   /usr/local are uid 0, mode 0755, so the prefixes a host stack declares pass as they are.
 */
const rootOnlyProblem = (stat: FileStat | undefined): string | undefined => {
  if (stat === undefined) return 'is missing';
  if (stat.kind !== 'directory') return `is a ${stat.kind}, not a directory`;
  if (stat.uid !== 0) return `is owned by uid ${String(stat.uid)}, not root`;
  if ((stat.mode & 0o022) !== 0) {
    return `is writable by group or other (mode ${stat.mode.toString(8).padStart(4, '0')})`;
  }
  return undefined;
};

/**
 * Refuse a prefix that is not a root-only directory, a symlink or a non-directory between the
 * prefix and `path`, and anything but a file at it.
 */
export const assertPlainPath = async (
  base: HostRunner,
  prefix: string,
  path: string,
  expect: Expect,
): Promise<'file' | 'absent'> => {
  const dirs = betweenDirs(prefix, path);
  const [prefixStat, ...stats] = await Promise.all([prefix, ...dirs].map((dir) => base.stat(dir)));
  const bad = rootOnlyProblem(prefixStat);
  if (bad !== undefined) {
    throw refuse(
      path,
      `the declared prefix ${prefix} ${bad}. Declare only a real directory that root owns and ` +
        'only root may write. Nothing ran as root.',
    );
  }
  for (const [index, stat] of stats.entries()) {
    const dir = String(dirs[index]);
    if (stat?.kind !== 'directory') {
      throw refuse(
        path,
        `${dir} is ${stat === undefined ? 'missing' : `a ${stat.kind}`}; root ` +
          'writes only through real directories under a declared prefix.',
      );
    }
    const below = rootOnlyProblem(stat);
    if (below !== undefined) {
      throw refuse(
        path,
        `${dir} ${below}. Every directory from the prefix ${prefix} down to the file must be one ` +
          'that root owns and only root may write. Nothing ran as root.',
      );
    }
  }
  const target = await base.stat(path);
  if (target === undefined && expect === 'file-or-absent') return 'absent';
  if (target?.kind === 'file') return 'file';
  throw refuse(path, `is ${target === undefined ? 'missing' : `a ${target.kind}`}, not a file`);
};

/**
 * ⛔ A ROOT-OWNED FILE UNDER A PREFIX IS ROOT'S TO CHANGE, AND ONLY ROOT'S (decided 2026-09-21).
 *   Group- or world-writable, anyone in that class rewrites a file root installed — a daemon's
 *   config, a script a LaunchDaemon runs as root — which is root by another name. Setuid or setgid,
 *   it runs as root (or its group) for whoever executes it. install(1) would apply either, as root.
 * ★ Root-owned is an omitted owner (the runner installs as root under a prefix) or uid 0. A file
 *   handed to another user is that user's to change; the sticky bit changes nothing on a file.
 */
export const modeProblem = (options: WriteOptions): string | undefined => {
  if (options.uid !== undefined && options.uid !== 0) return undefined;
  const found: string[] = [];
  if ((options.mode & 0o6000) !== 0) found.push('setuid/setgid');
  if ((options.mode & 0o022) !== 0) found.push('writable by group or other');
  if (found.length === 0) return undefined;
  return `mode ${options.mode.toString(8).padStart(4, '0')} is ${found.join(' and ')} on a root-owned file`;
};

/**
 * Every check a write under `prefix` meets before anything is staged or run as root: the mode, the
 * path (assertPlainPath) and the read-back (assertReadableBack). ★ Reads only, as the deploying
 *   user — so sudoRunner's `checkWrite` runs it at PLAN time too, and a plan still never calls sudo.
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
  await assertPlainPath(base, prefix, path, 'file-or-absent');
  await assertReadableBack(base, path, options, groups);
};

/**
 * POSIX read permission for one uid: owner class, else group class, else other. `undefined` when
 * only group membership could decide and the groups are unknown.
 * ⚠️ EXACTLY ONE CLASS APPLIES. A group member gets the group bits even when the other bits are
 *   wider (`0604` hides a file from its group), so "other can read" is not enough on its own.
 */
export const canRead = (
  file: { readonly uid: number; readonly gid: number; readonly mode: number },
  uid: number,
  groups: readonly number[] | undefined,
): boolean | undefined => {
  if (uid === 0) return true;
  if (file.uid === uid) return (file.mode & 0o400) !== 0;
  const groupRead = (file.mode & 0o040) !== 0;
  const otherRead = (file.mode & 0o004) !== 0;
  // Membership cannot change the answer when both classes agree.
  if (groupRead === otherRead) return groupRead;
  if (groups === undefined) return undefined;
  return groups.includes(file.gid) ? groupRead : otherRead;
};

/**
 * ⛔ REFUSE A FILE THE DEPLOYING USER COULD NOT READ BACK, before writing it. Both providers read
 *   every write back to verify it (host-file-lifecycle.ts, job-lifecycle.ts) and read it again at
 *   every plan, as the deploying user; this runner elevates writes, never reads. A root-only
 *   `0600` would be installed, then fail the read-back with EACCES and stay on disk with no state,
 *   so every later plan would fail too.
 * ★ An omitted owner is root (under a prefix the runner writes as root). An omitted group is the
 *   parent directory's, which is the group a new file gets on macOS.
 * ⚠️ Unknown groups never refuse: the read-back after the write stays the final judge.
 */
export const assertReadableBack = async (
  base: HostRunner,
  path: string,
  options: WriteOptions,
  groups: readonly number[] | undefined,
): Promise<void> => {
  const operator = base.effectiveUid();
  const parent = path.slice(0, path.lastIndexOf('/')) || '/';
  const gid = options.gid ?? (await base.stat(parent))?.gid ?? 0;
  const file = { gid, mode: options.mode, uid: options.uid ?? 0 };
  if (canRead(file, operator, groups) !== false) return;
  throw refuse(
    path,
    `owner ${String(file.uid)}, group ${String(gid)}, mode ${file.mode.toString(8)} would hide it ` +
      `from the deploying user (uid ${String(operator)}), who reads every file back. Declare a ` +
      'mode that user can read, or deploy as root. Nothing was written.',
  );
};

/**
 * The deploying user's groups, from `id -G`; `undefined` when that fails.
 * ⚠️ NOT process.getgroups(). MEASURED 2026-09-21 on macOS 27.2: getgroups() returned 16 groups
 *   where `id -G` returned 18, because macOS caps a process's own list at 16. A group past the
 *   16th would read as "not a member" and refuse a file the user can in fact read.
 */
export const operatorGroups = async (base: HostRunner): Promise<readonly number[] | undefined> => {
  const result = await base.exec(['/usr/bin/id', '-G']);
  const ids = result.stdout.trim().split(/\s+/);
  return result.exitCode === 0 && ids.every((id) => /^\d+$/.test(id)) ? ids.map(Number) : undefined;
};
