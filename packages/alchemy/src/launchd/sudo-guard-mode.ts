/**
 * The mode/owner and read-back half of sudo-guard.ts, split out to keep that file under the
 * house's 250-line cap. `assertPlainPath` (path chain) stays there; this is "is the mode/owner
 * safe, and can the deploying user read the result back" — re-exported from sudo-guard.ts so
 * nothing importing from there has to know this file exists.
 */
import type { HostRunner, WriteOptions } from './runner.ts';
import { SudoRefusedError } from './sudo-allowlist.ts';

const refuse = (path: string, message: string): Error =>
  new SudoRefusedError(`sudoRunner ${path}: ${message}`);

/**
 * ⛔ A ROOT-OWNED FILE UNDER A PREFIX IS ROOT'S TO CHANGE, AND ONLY ROOT'S (decided 2026-09-21).
 *   Group- or world-writable, anyone in that class rewrites a file root installed — a daemon's
 *   config, a script a LaunchDaemon runs as root — which is root by another name. Setuid or setgid,
 *   it runs as root (or its group) for whoever executes it. install(1) would apply either, as root.
 * ★ Root-owned is an omitted owner (the runner installs as root under a prefix) or uid 0. A file
 *   handed to another user is that user's to change; the sticky bit changes nothing on a file.
 * 🔴 MEASURED (adversarial review, 2026-09-23, round 1): "handed to another user" checked only
 *   `uid`, never `gid`. `{ uid: 501, gid: 0, mode: 0o2775 }` — a setgid file owned by an
 *   unprivileged uid but GROUPED to root — passed untouched, because a non-zero uid alone skipped
 *   every check below. Fixed by also treating `gid: 0` as root-adjacent.
 * 🔴 MEASURED (adversarial review, round 2, same day): the round-1 fix still missed an OMITTED
 *   `gid`. `remote-file-plan.ts`'s `identity()` returns no `gid` key at all when a `RemoteFile`
 *   declares no `group`, so `{ uid: 501, mode: 0o2775 }` reaches this check with `gid: undefined`
 *   — neither `0` nor genuinely someone else's. `sudo-write.ts` then omits `-g` from `install`
 *   entirely, and GNU `install`, run as root via `sudo -n`, defaults an omitted `-g` to the
 *   INVOKING PROCESS's group — root's own — whenever the destination directory is not itself
 *   setgid (which none of this runner's declared prefixes are, measured in linux-host-measured.md).
 *   The file lands exactly as `{ uid: 501, gid: 0, mode: 0o2775 }` — the identical escalation the
 *   round-1 fix closed, reached by OMISSION instead of an explicit `group: 0`. So "root-adjacent"
 *   now also means an omitted `gid`: only a file with a genuinely non-root, EXPLICITLY GIVEN owner
 *   AND group is someone else's alone to make setuid/setgid or writable — an omission is never
 *   read as a safe default on either side, uid or gid.
 */
export const modeProblem = (options: WriteOptions): string | undefined => {
  const rootAdjacent =
    options.uid === undefined ||
    options.uid === 0 ||
    options.gid === undefined ||
    options.gid === 0;
  if (!rootAdjacent) return undefined;
  const found: string[] = [];
  if ((options.mode & 0o6000) !== 0) found.push('setuid/setgid');
  if ((options.mode & 0o022) !== 0) found.push('writable by group or other');
  if (found.length === 0) return undefined;
  return `mode ${options.mode.toString(8).padStart(4, '0')} is ${found.join(' and ')} on a root-owned file`;
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
