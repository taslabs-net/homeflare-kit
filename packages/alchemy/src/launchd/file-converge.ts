/**
 * The one path a declared file's bytes take onto a host, shared by every resource that owns ONE
 * whole file: `Host.File` (text it was handed) and `Release.Binary` (bytes it downloaded and
 * verified). Read, diff, converge and delete, as plain async functions over a HostRunner.
 *
 * ★ EXTRACTED FROM host-file-lifecycle.ts, NOT COPIED (2026-09-22). The ownership rules below — a
 *   file this resource does not own is never overwritten, a move onto an occupied path stays
 *   refused, a failed create is rolled back — were red-teamed on Host.File (docs/ownership.md). A
 *   second resource that writes a whole file gets them by calling this, so a fix lands in both.
 * ★ THE BYTES ARE ASKED FOR ONLY WHEN A WRITE IS DUE (`bytesFor`). Host.File has them already; a
 *   binary has only a pinned digest until it downloads, and a host whose file already matches
 *   must not cost a 120 MB download to prove it.
 * ⛔ SYMLINKS AND DIRECTORIES ARE REFUSED, NOT REPLACED. rename(2) over a symlink replaces the LINK,
 *   so a path that is a symlink (nix-darwin's /etc entries point into /nix/store) would be quietly
 *   taken from the tool that owns it — which puts it back, or refuses its next activation. Remove
 *   the path from its owner first, then declare it here.
 */
import type { Diff } from 'alchemy/Diff';
import { leaveOldPath, oneFile } from './file-identity.ts';
import type { HostFileAttributes } from './host-file-form.ts';
import { sha256Hex } from './job-form.ts';
import { type HostRunner, type WriteOptions, canActAsRoot } from './runner.ts';

/** What a whole file must be: where, which bytes (by digest), which mode and owner. */
export type FileTarget = {
  readonly path: string;
  readonly sha256: string;
  readonly mode: number;
  readonly uid?: number;
  readonly gid?: number;
};

/** A family's refusal: `<Type> <path>: <message>`, so a deploy log names the resource that said no. */
export type Refuse = (path: string, message: string) => Error;

const numericId = (value: string | number): number | undefined =>
  typeof value === 'number' ? value : /^\d+$/.test(value) ? Number(value) : undefined;

/** Resolve a declared owner and group (names or ids) to ids through the runner. */
export const resolveIds = async (
  runner: HostRunner,
  declared: { readonly owner?: string | number; readonly group?: string | number },
  path: string,
  refuse: Refuse,
): Promise<{ uid?: number; gid?: number }> => {
  let uid: number | undefined;
  let gid: number | undefined;
  if (declared.owner !== undefined) {
    uid = numericId(declared.owner) ?? (await runner.lookupUser(String(declared.owner)))?.uid;
    if (uid === undefined) throw refuse(path, `no user ${String(declared.owner)} on this host`);
  }
  if (declared.group !== undefined) {
    gid = numericId(declared.group) ?? (await runner.lookupGroup(String(declared.group)));
    if (gid === undefined) throw refuse(path, `no group ${String(declared.group)} on this host`);
  }
  return { ...(uid === undefined ? {} : { uid }), ...(gid === undefined ? {} : { gid }) };
};

/** The file as it is now, or `undefined` when nothing is at the path. Non-files read with no digest. */
export const readFileAttributes = async (
  runner: HostRunner,
  path: string,
): Promise<HostFileAttributes | undefined> => {
  const stat = await runner.stat(path);
  if (stat === undefined) return undefined;
  const bytes = stat.kind === 'file' ? await runner.readFile(path) : undefined;
  return {
    gid: stat.gid,
    mode: stat.mode,
    path,
    sha256: bytes === undefined ? '' : sha256Hex(bytes),
    size: stat.size,
    uid: stat.uid,
  };
};

export const writeOptionsOf = (want: FileTarget): WriteOptions => ({
  mode: want.mode,
  ...(want.uid === undefined ? {} : { uid: want.uid }),
  ...(want.gid === undefined ? {} : { gid: want.gid }),
});

export const fileMatches = (live: HostFileAttributes, want: FileTarget): boolean =>
  live.sha256 === want.sha256 &&
  live.mode === want.mode &&
  (want.uid === undefined || live.uid === want.uid) &&
  (want.gid === undefined || live.gid === want.gid);

/**
 * ★ A PLAN THAT WILL WRITE ASKS THE RUNNER FIRST (`checkWrite`, when it has one): sudoRunner's
 *   refusals — a setuid or group-writable root file, a directory under a prefix another user may
 *   change — then fail the plan, before any resource is applied, instead of halfway through it.
 */
export const diffTarget = async (
  runner: HostRunner,
  want: FileTarget,
  output: HostFileAttributes,
): Promise<Diff> => {
  const writes = async (diff: Diff): Promise<Diff> => {
    await runner.checkWrite?.(want.path, writeOptionsOf(want));
    return diff;
  };
  // ★ Create-before-delete: two paths can hold two files at once, so nothing forces deleteFirst.
  // ⛔ …unless the two paths are ONE file (file-identity.ts). That is a respelling, not a move: a
  //   replace would let Phase 2 delete the old generation's path, which is the new one's file. An
  //   update records the new spelling, and convergeFile keeps the file.
  if (want.path !== output.path) {
    const same = await oneFile(runner, want.path, output.path);
    return writes({ action: same === true ? 'update' : 'replace' });
  }
  if (want.sha256 !== output.sha256) return writes({ action: 'update' });
  const live = await readFileAttributes(runner, want.path);
  return live !== undefined && fileMatches(live, want)
    ? { action: 'noop' }
    : writes({ action: 'update' });
};

export type Converge = {
  readonly want: FileTarget;
  /** The owner as declared (a name or an id), for the chown refusal's wording. */
  readonly owner?: string | number | undefined;
  /** The bytes to write, asked for only when a write is due; `before` is what is there now. */
  readonly bytesFor: (before: HostFileAttributes | undefined) => Promise<Uint8Array>;
  readonly refuse: Refuse;
};

/**
 * Make the file at `want.path` match `want`, and return it as read back.
 *
 * `adopt` is whether adoption is on AND this apply is a create or an unfinished generation of our
 * own (ownership/adopt.ts adoptsAtApply). It lets such a generation take over a file already at the
 * path — the takeover the plan's probe would have allowed, had it run. ⛔ A move onto an occupied
 *   path stays refused, both ways the engine drives one: an `update` across the move (`moved`,
 *   below), and a fresh replace's new generation, which the caller never marks adoptable (its
 *   `output` is undefined too, so this function cannot tell it from a create by itself).
 */
export const convergeFile = async (
  runner: HostRunner,
  spec: Converge,
  output?: HostFileAttributes,
  adopt = false,
): Promise<HostFileAttributes> => {
  const { want, refuse } = spec;
  const path = want.path;
  // ⛔ NO SILENT SUDO: handing a file to another user is root's call (chown(2)), so say so up front.
  if (want.uid !== undefined && want.uid !== runner.effectiveUid() && !canActAsRoot(runner)) {
    throw refuse(
      path,
      `owner ${String(spec.owner)} is not the deploying user; only root may chown. Deploy as root ` +
        'or through a privileged HostRunner (sudoRunner() with this path under a prefix). This ' +
        'provider never calls sudo itself.',
    );
  }
  const stat = await runner.stat(path);
  if (stat !== undefined && stat.kind !== 'file') {
    throw refuse(
      path,
      `is a ${stat.kind}; remove it from whatever owns it before declaring it here`,
    );
  }
  const before = stat === undefined ? undefined : await readFileAttributes(runner, path);
  // ⚠️ An `output` at another path: the engine planned an UPDATE across a move, which it does
  //   when diff could not see the new path (host-file.ts). Finish it the way a replace would.
  //   ★ A respelling of ONE file (file-identity.ts) still counts as moved here, so a file there
  //   that does not match is refused below — never rewritten in place under the old spelling's pins.
  const moved = output !== undefined && output.path !== path;
  const prior = moved ? undefined : output;
  /**
   * ⛔ A FILE THIS RESOURCE DOES NOT OWN IS NEVER OVERWRITTEN. With no prior state for this path,
   *   the engine's adoption probe has already refused anything it found — except where it never
   *   looked: the new path of a replace, and a create whose props still held an Output at plan
   *   time. A path typo there would otherwise overwrite, say, a system file that a fresh
   *   declaration of the same path would have been refused as `Unowned`. ★ With adoption on, a
   *   create takes it over, as the probe would have let it (decided 2026-09-21).
   */
  const takeOver = adopt && output === undefined;
  if (prior === undefined && before !== undefined && !fileMatches(before, want) && !takeOver) {
    throw refuse(
      path,
      'already exists and is not this resource. Remove it, or declare it as a new resource and ' +
        'deploy with --adopt.',
    );
  }
  if (before === undefined || !fileMatches(before, want)) {
    const bytes = await spec.bytesFor(before);
    // ⛔ THE ONE WRITER NEVER WRITES BYTES THAT ARE NOT THE DECLARED ONES. Host.File's always are;
    //   a supplier that verifies elsewhere (a download) is held to the same digest here, last.
    if (sha256Hex(bytes) !== want.sha256) {
      throw refuse(path, `the bytes to write do not hash to ${want.sha256}. Nothing was written.`);
    }
    await runner.writeFileAtomic(path, bytes, writeOptionsOf(want));
  }
  // ⚠️ READ BACK, never echo the declaration: a umask, an ACL or a runner that ignored `uid` shows
  //   up here as a refusal instead of as a forever-`update`.
  // ⚠️ Roll back a CREATE: left behind, the next plan's recovery `read` finds a file with no state,
  //   reports it `Unowned`, and every later deploy demands --adopt for our own file. ⛔ Also when
  //   the read-back THROWS: MEASURED 2026-09-22, a 0111 binary written as a non-root operator read
  //   back EACCES and stayed, and every later plan's probe failed with the same EACCES.
  const rollBack = async () => {
    if (before === undefined) await runner.removeFile(path).catch(() => undefined);
  };
  const after = await readFileAttributes(runner, path).catch(async (cause: unknown) => {
    await rollBack();
    throw refuse(path, `the write returned but reading it back failed: ${String(cause)}`);
  });
  if (after === undefined || !fileMatches(after, want)) {
    await rollBack();
    throw refuse(path, 'the write returned but the file on disk does not match the declaration');
  }
  // ★ Create-before-delete, as the replace would have been: the old path goes only once the new
  //   one is written and verified — and ⛔ never when the old path IS this file (file-identity.ts).
  if (moved)
    await leaveOldPath(
      runner,
      output.path,
      path,
      () => removeWholeFile(runner, output, refuse),
      refuse,
    );
  return after;
};

/** Remove the file. Idempotent. ⛔ Refuses a path that has since become a symlink or directory. */
export const removeWholeFile = async (
  runner: HostRunner,
  output: HostFileAttributes,
  refuse: Refuse,
): Promise<void> => {
  const stat = await runner.stat(output.path);
  if (stat === undefined) return;
  if (stat.kind !== 'file') throw refuse(output.path, `is now a ${stat.kind}; not removing it`);
  await runner.removeFile(output.path);
};
