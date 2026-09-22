/**
 * RemoteFile's diff / reconcile / delete over a HostRunner, so the whole lifecycle runs against a
 * fake host in tests with no ssh and no real write. What it would write is worked out next door
 * (remote-file-plan.ts); this file is the part that decides to act.
 *
 * ⛔ IN REGION MODE, DRIFT MEANS THE REGION AND NOTHING ELSE. Every byte outside the markers belongs
 *   to another owner, so a change there must never plan an update — otherwise the two owners fight
 *   on every deploy and this resource loses the right to be in that file at all.
 * ⚠️ THE WRITE REPLACES THE INODE, in both modes. A process holding the old file keeps reading it
 *   until it reopens, and a hard link to the path stops tracking. That is the price of never
 *   leaving a torn file, and it is the trade the launchd family already makes.
 */
import type { Diff } from 'alchemy/Diff';
import { sha256Hex } from '../launchd/job-form.ts';
import { type HostRunner, canActAsRoot } from '../launchd/runner.ts';
import { removeRegion } from './region.ts';
import {
  DEFAULT_MODE,
  type RemoteFileAttributes,
  type RemoteFileProps,
} from './remote-file-form.ts';
import {
  decoder,
  digestOf,
  encoder,
  identity,
  ownedDigest,
  planWrite,
  readFileAttributes,
  refuse,
} from './remote-file-plan.ts';

export { readFileAttributes } from './remote-file-plan.ts';

/**
 * ★ A PLAN THAT WILL WRITE ASKS THE RUNNER FIRST (`checkWrite`, when it has one), so a runner's own
 *   refusals fail the plan instead of arriving halfway through the apply.
 */
export const diffFile = async (
  runner: HostRunner,
  news: RemoteFileProps,
  output: RemoteFileAttributes,
): Promise<Diff> => {
  const want = await identity(runner, news);
  if (news.path !== output.path) {
    // ★ Create-before-delete: two paths hold two files at once, so nothing forces deleteFirst.
    await runner.checkWrite?.(news.path, { mode: news.mode ?? DEFAULT_MODE, ...want });
    return { action: 'replace' };
  }
  const planned = await planWrite(runner, news, want);
  // ⛔ BOTH digests: the live one catches a hand edit, the STORED one catches a write that landed
  //   and whose deploy then died before committing. Either alone reports `noop` over a wrong file.
  if (planned.converged && output.contentSha256 === digestOf(news.content)) {
    return { action: 'noop' };
  }
  await runner.checkWrite?.(news.path, planned.write);
  return { action: 'update' };
};

/**
 * `adopt` is whether adoption is on AND this apply is a create or an unfinished generation of our
 * own (ownership/adopt.ts). It lets such a generation take over what is already at the path — the
 * takeover the plan's probe would have allowed, had it run.
 * ★ IN REGION MODE THE FILE BEING THERE IS NOT A TAKEOVER: it belongs to someone else by
 *   definition. What this resource claims is the block, so only a block already present with other
 *   content is the thing adoption is asked about.
 */
export const reconcileFile = async (
  runner: HostRunner,
  props: RemoteFileProps,
  output?: RemoteFileAttributes,
  adopt = false,
): Promise<RemoteFileAttributes> => {
  const want = await identity(runner, props);
  // ⛔ NO SILENT SUDO: handing a file to another user is root's call (chown(2)), so say so up front.
  if (want.uid !== undefined && want.uid !== runner.effectiveUid() && !canActAsRoot(runner)) {
    throw refuse(
      props.path,
      `owner ${String(props.owner)} is not the deploying user; only root may chown. Deploy through ` +
        'a root destination or a privileged HostRunner. This provider never calls sudo itself.',
    );
  }
  const moved = output !== undefined && output.path !== props.path;
  const prior = moved ? undefined : output;
  const planned = await planWrite(runner, props, want);
  const live = ownedDigest(planned.before, props.region);
  const declared = digestOf(props.content);
  /**
   * ⛔ SOMETHING WE DO NOT OWN IS NEVER OVERWRITTEN. With no prior state the engine's probe has
   *   already refused whatever it found — except where it never looked: a replace's new path, and a
   *   create whose props still held an Output at plan time. A path typo there would otherwise
   *   overwrite a system file. ★ With adoption on, a create takes it over, as the probe would have.
   */
  if (
    prior === undefined &&
    live !== undefined &&
    live !== declared &&
    !(adopt && output === undefined)
  ) {
    throw refuse(
      props.path,
      `${props.region === undefined ? 'already exists' : 'already carries that managed region'}` +
        ' and is not this resource. Remove it, or declare it as a new resource and deploy --adopt.',
    );
  }
  if (!planned.converged) await runner.writeFileAtomic(props.path, planned.bytes, planned.write);
  /**
   * ⚠️ READ BACK, never echo the declaration: a umask, an ACL or a runner that ignored `uid` shows
   *   up here as a refusal instead of as a forever-`update`.
   */
  const after = await readFileAttributes(runner, props.path, props.region);
  if (
    after === undefined ||
    after.sha256 !== sha256Hex(planned.bytes) ||
    after.contentSha256 !== declared
  ) {
    /**
     * ⚠️ Roll back a CREATE only: left behind, the next plan's recovery read finds a file with no
     *   state, reports it Unowned, and every later deploy demands --adopt for our own file.
     * ⛔ NEVER IN REGION MODE — the file was someone else's before this deploy and must survive it.
     */
    if (planned.before === undefined && props.region === undefined) {
      await runner.removeFile(props.path).catch(() => undefined);
    }
    throw refuse(
      props.path,
      'the write returned but the file on disk does not match the declaration',
    );
  }
  // ★ Create-before-delete, as the replace would have been: the old path goes once the new one is
  //   written and verified.
  if (moved && output !== undefined) await deleteFile(runner, output);
  return after;
};

/**
 * Whole-file mode removes the file. ⛔ REGION MODE REMOVES ONLY THE BLOCK, leaving every other byte
 *   identical — removing the file would delete another owner's configuration. Idempotent both ways.
 */
export const deleteFile = async (
  runner: HostRunner,
  output: RemoteFileAttributes,
): Promise<void> => {
  const stat = await runner.stat(output.path);
  if (stat === undefined) return;
  if (stat.kind !== 'file') throw refuse(output.path, `is now a ${stat.kind}; not touching it`);
  if (output.region === undefined) {
    await runner.removeFile(output.path);
    return;
  }
  const bytes = await runner.readFile(output.path);
  if (bytes === undefined) return;
  const before = decoder.decode(bytes);
  const next = removeRegion(before, output.region);
  if (next === before) return;
  await runner.writeFileAtomic(output.path, encoder.encode(next), {
    gid: stat.gid,
    mode: stat.mode,
    uid: stat.uid,
  });
};
