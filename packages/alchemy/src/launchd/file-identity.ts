/**
 * Whether two paths name ONE file — the question a move must answer before it deletes its old
 * path, and a plan before it answers `replace`.
 *
 * 🔴 MEASURED 2026-09-22 (release/binary-alias.test.ts, localRunner over a real temp directory,
 *   through Alchemy's own Plan and Apply): a Release.Binary whose directory was respelled to
 *   another path for the SAME file — through a symlinked parent (`/tmp` → `/private/tmp`, `/etc`
 *   → `/private/etc`), or by case alone on case-insensitive APFS, macOS's default — planned a
 *   `replace`. The new generation took the file already there as its own (same bytes, same mode:
 *   file-converge.ts's resume rule), then Phase 2 deleted the old generation's path, which was that
 *   same file. The deploy SUCCEEDED and the binary was gone. The `update` route lost it in one step:
 *   convergeFile's move removed the old path after "writing" the new one. Host.File shares both.
 * ★ IDENTITY, NOT SPELLING. Case-folding the strings would be wrong on a case-sensitive volume and
 *   blind to a symlinked parent; device and inode from lstat are what the kernel itself compares.
 * ⚠️ A HARD LINK also shares an inode. At the old path of a move it is therefore kept, not removed:
 *   one stray link left behind, rather than the risk of deleting the file just verified.
 */
import type { FileStat, HostRunner } from './runner.ts';

/**
 * `true` when both entries exist and are one file; `false` when either is absent or they differ;
 * `undefined` when the runner reported no identity, so nobody can tell (fakes, custom runners).
 */
export const sameEntry = (
  a: FileStat | undefined,
  b: FileStat | undefined,
): boolean | undefined => {
  if (a === undefined || b === undefined) return false;
  if (a.dev === undefined || a.ino === undefined || b.dev === undefined || b.ino === undefined) {
    return undefined;
  }
  return a.dev === b.dev && a.ino === b.ino;
};

/** Whether `a` and `b` are one file on this host right now. Equal strings always are. */
export const oneFile = async (
  runner: HostRunner,
  a: string,
  b: string,
): Promise<boolean | undefined> => {
  if (a === b) return true;
  const [left, right] = await Promise.all([runner.stat(a), runner.stat(b)]);
  return sameEntry(left, right);
};

/**
 * The last step of a move: `remove` the old path unless it is the file just verified at `path`.
 * ⚠️ A runner that reports no identity cannot be asked beforehand, so `path` is checked after: a
 *   file lost to a respelling then fails the deploy instead of reporting success.
 */
export const leaveOldPath = async (
  runner: HostRunner,
  oldPath: string,
  path: string,
  remove: () => Promise<void>,
  refuse: (path: string, message: string) => Error,
): Promise<void> => {
  const same = await oneFile(runner, oldPath, path);
  if (same === true) return;
  await remove();
  if (same === undefined && (await runner.stat(path)) === undefined) {
    throw refuse(
      path,
      `removing the old path ${oldPath} removed this file too: they are one file under two ` +
        'spellings (a symlinked parent, or case on a case-insensitive volume). Deploy again to ' +
        'reinstall it, and keep one spelling.',
    );
  }
};
