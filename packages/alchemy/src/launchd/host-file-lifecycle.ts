/**
 * HostFile's read / diff / reconcile / delete as plain async functions over a HostRunner, so the
 * lifecycle runs against fake-runner.ts in tests.
 *
 * ⛔ SYMLINKS AND DIRECTORIES ARE REFUSED, NOT REPLACED. rename(2) over a symlink replaces the LINK,
 *   so a path that is a symlink (nix-darwin's /etc entries point into /nix/store) would be quietly
 *   taken from the tool that owns it — which puts it back, or refuses its next activation. Remove
 *   the path from its owner first, then declare it here.
 */
import type { Diff } from 'alchemy/Diff';
import {
  DEFAULT_MODE,
  type HostFileAttributes,
  type HostFileProps,
  fileProblems,
} from './host-file-form.ts';
import { sha256Hex } from './job-form.ts';
import { type HostRunner, type WriteOptions, canActAsRoot } from './runner.ts';

type Desired = {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly mode: number;
  readonly uid?: number;
  readonly gid?: number;
};

const refuse = (path: string, message: string): Error => new Error(`Host.File ${path}: ${message}`);

const numericId = (value: string | number): number | undefined =>
  typeof value === 'number' ? value : /^\d+$/.test(value) ? Number(value) : undefined;

/** Validate, then resolve owner/group names to ids through the runner. */
export const desiredFile = async (runner: HostRunner, props: HostFileProps): Promise<Desired> => {
  const found = fileProblems(props);
  if (found.length > 0) throw refuse(props.path, found.join('; '));
  const bytes = new TextEncoder().encode(props.content);
  let uid: number | undefined;
  let gid: number | undefined;
  if (props.owner !== undefined) {
    uid = numericId(props.owner) ?? (await runner.lookupUser(String(props.owner)))?.uid;
    if (uid === undefined) throw refuse(props.path, `no user ${String(props.owner)} on this host`);
  }
  if (props.group !== undefined) {
    gid = numericId(props.group) ?? (await runner.lookupGroup(String(props.group)));
    if (gid === undefined) throw refuse(props.path, `no group ${String(props.group)} on this host`);
  }
  return {
    bytes,
    mode: props.mode ?? DEFAULT_MODE,
    sha256: sha256Hex(bytes),
    ...(uid === undefined ? {} : { uid }),
    ...(gid === undefined ? {} : { gid }),
  };
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

const writeOptionsOf = (want: Desired): WriteOptions => ({
  mode: want.mode,
  ...(want.uid === undefined ? {} : { uid: want.uid }),
  ...(want.gid === undefined ? {} : { gid: want.gid }),
});

const matches = (live: HostFileAttributes, want: Desired): boolean =>
  live.sha256 === want.sha256 &&
  live.mode === want.mode &&
  (want.uid === undefined || live.uid === want.uid) &&
  (want.gid === undefined || live.gid === want.gid);

/**
 * ★ A PLAN THAT WILL WRITE ASKS THE RUNNER FIRST (`checkWrite`, when it has one): sudoRunner's
 *   refusals — a setuid or group-writable root file, a directory under a prefix another user may
 *   change — then fail the plan, before any resource is applied, instead of halfway through it.
 */
export const diffFile = async (
  runner: HostRunner,
  news: HostFileProps,
  output: HostFileAttributes,
): Promise<Diff> => {
  const want = await desiredFile(runner, news);
  const writes = async (diff: Diff): Promise<Diff> => {
    await runner.checkWrite?.(news.path, writeOptionsOf(want));
    return diff;
  };
  // ★ Create-before-delete: two paths can hold two files at once, so nothing forces deleteFirst.
  if (news.path !== output.path) return writes({ action: 'replace' });
  if (want.sha256 !== output.sha256) return writes({ action: 'update' });
  const live = await readFileAttributes(runner, news.path);
  return live !== undefined && matches(live, want)
    ? { action: 'noop' }
    : writes({ action: 'update' });
};

/**
 * `adopt` is what `--adopt` / `adopt(…)` resolve to for this resource (ownership/adopt.ts). It lets a
 * CREATE take over a file already at the path — the takeover the plan's probe would have allowed,
 * had it run — and nothing else: a move onto an occupied path stays refused.
 */
export const reconcileFile = async (
  runner: HostRunner,
  props: HostFileProps,
  output?: HostFileAttributes,
  adopt = false,
): Promise<HostFileAttributes> => {
  const want = await desiredFile(runner, props);
  // ⛔ NO SILENT SUDO: handing a file to another user is root's call (chown(2)), so say so up front.
  if (want.uid !== undefined && want.uid !== runner.effectiveUid() && !canActAsRoot(runner)) {
    throw refuse(
      props.path,
      `owner ${String(props.owner)} is not the deploying user; only root may chown. Deploy as root ` +
        'or through a privileged HostRunner (sudoRunner() with this path under a prefix). This ' +
        'provider never calls sudo itself.',
    );
  }
  const stat = await runner.stat(props.path);
  if (stat !== undefined && stat.kind !== 'file') {
    throw refuse(
      props.path,
      `is a ${stat.kind}; remove it from whatever owns it before declaring it here`,
    );
  }
  const before = stat === undefined ? undefined : await readFileAttributes(runner, props.path);
  // ⚠️ An `output` at another path: the engine planned an UPDATE across a move, which it does
  //   when diff could not see the new path (host-file.ts). Finish it the way a replace would.
  const moved = output !== undefined && output.path !== props.path;
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
  if (prior === undefined && before !== undefined && !matches(before, want) && !takeOver) {
    throw refuse(
      props.path,
      'already exists and is not this resource. Remove it, or declare it as a new resource and ' +
        'deploy with --adopt.',
    );
  }
  if (before === undefined || !matches(before, want)) {
    await runner.writeFileAtomic(props.path, want.bytes, writeOptionsOf(want));
  }
  // ⚠️ READ BACK, never echo the declaration: a umask, an ACL or a runner that ignored `uid` shows
  //   up here as a refusal instead of as a forever-`update`.
  const after = await readFileAttributes(runner, props.path);
  if (after === undefined || !matches(after, want)) {
    // ⚠️ Roll back a CREATE: left behind, the next plan's recovery `read` finds a file with no
    //   state, reports it `Unowned`, and every later deploy demands --adopt for our own file.
    if (before === undefined) await runner.removeFile(props.path).catch(() => undefined);
    throw refuse(
      props.path,
      'the write returned but the file on disk does not match the declaration',
    );
  }
  // ★ Create-before-delete, as the replace would have been: the old path goes only once the new
  //   one is written and verified.
  if (moved) await deleteFile(runner, output);
  return after;
};

/** Remove the file. Idempotent. ⛔ Refuses a path that has since become a symlink or directory. */
export const deleteFile = async (runner: HostRunner, output: HostFileAttributes): Promise<void> => {
  const stat = await runner.stat(output.path);
  if (stat === undefined) return;
  if (stat.kind !== 'file') throw refuse(output.path, `is now a ${stat.kind}; not removing it`);
  await runner.removeFile(output.path);
};
