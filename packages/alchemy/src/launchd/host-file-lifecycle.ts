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
import { type HostRunner, canActAsRoot } from './runner.ts';

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

const matches = (live: HostFileAttributes, want: Desired): boolean =>
  live.sha256 === want.sha256 &&
  live.mode === want.mode &&
  (want.uid === undefined || live.uid === want.uid) &&
  (want.gid === undefined || live.gid === want.gid);

export const diffFile = async (
  runner: HostRunner,
  news: HostFileProps,
  output: HostFileAttributes,
): Promise<Diff> => {
  // ★ Create-before-delete: two paths can hold two files at once, so nothing forces deleteFirst.
  if (news.path !== output.path) return { action: 'replace' };
  const want = await desiredFile(runner, news);
  if (want.sha256 !== output.sha256) return { action: 'update' };
  const live = await readFileAttributes(runner, news.path);
  return live !== undefined && matches(live, want) ? { action: 'noop' } : { action: 'update' };
};

export const reconcileFile = async (
  runner: HostRunner,
  props: HostFileProps,
): Promise<HostFileAttributes> => {
  const want = await desiredFile(runner, props);
  // ⛔ NO SILENT SUDO: handing a file to another user is root's call (chown(2)), so say so up front.
  if (want.uid !== undefined && want.uid !== runner.effectiveUid() && !canActAsRoot(runner)) {
    throw refuse(
      props.path,
      `owner ${String(props.owner)} is not the deploying user; only root may chown. Deploy as root ` +
        'or through a privileged HostRunner (privileged: true). This provider never calls sudo.',
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
  if (before === undefined || !matches(before, want)) {
    await runner.writeFileAtomic(props.path, want.bytes, {
      mode: want.mode,
      ...(want.uid === undefined ? {} : { uid: want.uid }),
      ...(want.gid === undefined ? {} : { gid: want.gid }),
    });
  }
  // ⚠️ READ BACK, never echo the declaration: a umask, an ACL or a runner that ignored `uid` shows
  //   up here as a refusal instead of as a forever-`update`.
  const after = await readFileAttributes(runner, props.path);
  if (after === undefined || !matches(after, want)) {
    throw refuse(
      props.path,
      'the write returned but the file on disk does not match the declaration',
    );
  }
  return after;
};

/** Remove the file. Idempotent. ⛔ Refuses a path that has since become a symlink or directory. */
export const deleteFile = async (runner: HostRunner, output: HostFileAttributes): Promise<void> => {
  const stat = await runner.stat(output.path);
  if (stat === undefined) return;
  if (stat.kind !== 'file') throw refuse(output.path, `is now a ${stat.kind}; not removing it`);
  await runner.removeFile(output.path);
};
