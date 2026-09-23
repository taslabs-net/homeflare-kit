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
 * ⛔ AND EVERY DIRECTORY ABOVE THE PREFIX (red team, 2026-09-21). Whoever may write the prefix's
 *   parent may rename the prefix away and put a symlink in its place between these checks and the
 *   privileged call — the same swap one level up. So `/` down to the prefix's parent must be
 *   root-only too (a root-owned symlink among them, `/etc` -> `private/etc`, is root's own and is
 *   followed; its target is root's choice, and not walked).
 * ⛔ AND NO ACL THAT SAYS OTHERWISE (sudo-acl.ts): mode bits are not the whole answer on macOS.
 * ⚠️ These checks run before the privileged call, as the deploying user. They guard against a
 *   mistaken declaration and against every user but root; root itself could still change a path
 *   in that window.
 */
import type { FileStat, HostRunner, WriteOptions } from './runner.ts';
import { assertNoAclGrants } from './sudo-acl.ts';
import { SudoRefusedError } from './sudo-allowlist.ts';
import { assertReadableBack, modeProblem } from './sudo-guard-mode.ts';

export { assertReadableBack, canRead, modeProblem, operatorGroups } from './sudo-guard-mode.ts';

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

/** The directories strictly above `prefix`: `/`, then each one down to the prefix's parent. */
export const aboveDirs = (prefix: string): string[] => {
  const parts = prefix.split('/').slice(1, -1);
  return ['/', ...parts.map((_, index) => `/${parts.slice(0, index + 1).join('/')}`)];
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
 *   system's and is followed, as every path lookup does — when root owns it (aboveDirs).
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
  const above = aboveDirs(prefix);
  for (const [index, stat] of (await Promise.all(above.map((dir) => base.stat(dir)))).entries()) {
    const up = stat?.kind === 'symlink' && stat.uid === 0 ? undefined : rootOnlyProblem(stat);
    if (up !== undefined) {
      throw refuse(
        path,
        `${String(above[index])}, above the declared prefix ${prefix}, ${up}. Whoever may change it ` +
          'may swap the prefix itself; every directory from / down must be root-only. Nothing ran as root.',
      );
    }
  }
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
  await assertNoAclGrants(base, path, [...above, prefix, ...dirs]);
  const target = await base.stat(path);
  if (target === undefined && expect === 'file-or-absent') return 'absent';
  if (target?.kind === 'file') return 'file';
  throw refuse(path, `is ${target === undefined ? 'missing' : `a ${target.kind}`}, not a file`);
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
