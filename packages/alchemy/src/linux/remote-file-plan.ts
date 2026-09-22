/**
 * What RemoteFile would write, worked out from what is on the host right now — the half of the
 * lifecycle that reads and decides, with no write in it.
 *
 * ⛔ IN REGION MODE THE LIVE FILE IS AN INPUT, not merely something to compare against: the declared
 *   block is spliced into the bytes that are there, so every surrounding line survives verbatim.
 *   That is why this cannot be a pure function of the props the way a whole-file render is.
 */
import { sha256Hex } from '../launchd/job-form.ts';
import type { FileStat, HostRunner, WriteOptions } from '../launchd/runner.ts';
import { type RegionSpec, readRegion, spliceRegion } from './region.ts';
import {
  DEFAULT_MODE,
  type RemoteFileAttributes,
  type RemoteFileProps,
  fileProblems,
} from './remote-file-form.ts';

export const decoder = new TextDecoder();
export const encoder = new TextEncoder();

export const refuse = (path: string, message: string): Error =>
  new Error(`Remote.File ${path}: ${message}`);

const numericId = (value: string | number): number | undefined =>
  typeof value === 'number' ? value : /^\d+$/.test(value) ? Number(value) : undefined;

export type Identity = { readonly uid?: number; readonly gid?: number };

/** Validate, then resolve owner and group names to ids through the runner. */
export const identity = async (runner: HostRunner, props: RemoteFileProps): Promise<Identity> => {
  const found = fileProblems(props);
  if (found.length > 0) throw refuse(props.path, found.join('; '));
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
  return { ...(uid === undefined ? {} : { uid }), ...(gid === undefined ? {} : { gid }) };
};

export const digestOf = (text: string): string => sha256Hex(encoder.encode(text));

/** The digest of the part this resource owns, or `undefined` when that part is not there. */
export const ownedDigest = (
  file: string | undefined,
  region: RegionSpec | undefined,
): string | undefined => {
  if (file === undefined) return undefined;
  if (region === undefined) return digestOf(file);
  const body = readRegion(file, region);
  return body === undefined ? undefined : digestOf(body);
};

/** The file as it is now, plus the digest of the part this resource owns. */
export const readFileAttributes = async (
  runner: HostRunner,
  path: string,
  region: RegionSpec | undefined,
): Promise<RemoteFileAttributes | undefined> => {
  const stat = await runner.stat(path);
  if (stat === undefined) return undefined;
  const bytes = stat.kind === 'file' ? await runner.readFile(path) : undefined;
  const text = bytes === undefined ? undefined : decoder.decode(bytes);
  return {
    contentSha256: ownedDigest(text, region) ?? '',
    gid: stat.gid,
    mode: stat.mode,
    path,
    ...(region === undefined ? {} : { region }),
    sha256: bytes === undefined ? '' : sha256Hex(bytes),
    size: stat.size,
    uid: stat.uid,
  };
};

const matches = (stat: FileStat | undefined, write: WriteOptions): boolean =>
  stat !== undefined &&
  stat.mode === write.mode &&
  (write.uid === undefined || stat.uid === write.uid) &&
  (write.gid === undefined || stat.gid === write.gid);

export type Plan = {
  /** The whole file's new bytes, in both modes. */
  readonly bytes: Uint8Array;
  readonly write: WriteOptions;
  /** The bytes on disk right now, or `undefined` when nothing is there. */
  readonly before: string | undefined;
  /** Nothing to do: the file already says what we declare, with the mode and owner we declare. */
  readonly converged: boolean;
};

/**
 * ⛔ A SYMLINK OR A DIRECTORY IS REFUSED, NOT REPLACED. The write is a rename(2), which over a
 *   symlink replaces the LINK — quietly taking the path from whatever put it there (a config
 *   manager's `/etc` entries are symlinks, and so is `/etc/resolv.conf` on most Linux hosts).
 */
export const planWrite = async (
  runner: HostRunner,
  props: RemoteFileProps,
  want: Identity,
): Promise<Plan> => {
  const stat = await runner.stat(props.path);
  if (stat !== undefined && stat.kind !== 'file') {
    throw refuse(
      props.path,
      `is a ${stat.kind}; remove it from whatever owns it before declaring it here`,
    );
  }
  const current = stat === undefined ? undefined : await runner.readFile(props.path);
  const before = current === undefined ? undefined : decoder.decode(current);
  const declaredMode = props.mode ?? DEFAULT_MODE;
  if (props.region === undefined) {
    const write: WriteOptions = { mode: declaredMode, ...want };
    return {
      before,
      bytes: encoder.encode(props.content),
      converged: before === props.content && matches(stat, write),
      write,
    };
  }
  if (before === undefined) {
    if (props.create !== true) {
      throw refuse(
        props.path,
        'does not exist, and a managed region does not create the file it lives in. Check the ' +
          'path, declare the file itself, or pass create: true.',
      );
    }
    return {
      before,
      bytes: encoder.encode(spliceRegion('', props.region, props.content)),
      converged: false,
      write: { mode: declaredMode, ...want },
    };
  }
  const next = spliceRegion(before, props.region, props.content);
  /**
   * ⛔ THE FILE'S OWN MODE AND OWNER ARE COPIED BACK, never re-declared. We borrowed a block; the
   *   rename would otherwise hand a file someone else owns a mode and an owner this stack chose,
   *   which is a second claim nobody made.
   */
  return {
    before,
    bytes: encoder.encode(next),
    converged: next === before,
    write: { gid: stat?.gid ?? 0, mode: stat?.mode ?? declaredMode, uid: stat?.uid ?? 0 },
  };
};
