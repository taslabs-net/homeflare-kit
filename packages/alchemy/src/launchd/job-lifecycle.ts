/**
 * LaunchdJob's read / diff / reconcile / delete as plain async functions over a HostRunner — split
 * from job.ts so the whole lifecycle runs against fake-runner.ts in tests, with no real launchd.
 * The checks made before any write live in job-preflight.ts.
 *
 * ★ THE ORDER IS WRITE, BOOTOUT, BOOTSTRAP — not bootout first. launchd reads the plist only at
 *   bootstrap, so writing the new file while the old job runs changes nothing yet, and a write that
 *   fails (disk full, EACCES) leaves the old job running instead of leaving nothing running.
 * ⚠️ A FAILED BOOTSTRAP LEAVES THE JOB DOWN. On an UPDATE the new plist stays on disk, the state
 *   keeps the previous digest, and the next deploy retries. On a CREATE the plist this deploy wrote
 *   is removed again: left behind, the next plan's recovery `read` would find a plist with no
 *   state and report it `Unowned`, and every later deploy would demand `--adopt` for our own file.
 *   There is no rollback to an older plist: one that launchd refuses is a declaration to fix, and
 *   re-bootstrapping the old one could fail for the same host-side reason.
 */
import type { Diff } from 'alchemy/Diff';
import {
  type LaunchdJobAttributes,
  type LaunchdJobProps,
  parseDomain,
  renderJob,
  sha256Hex,
} from './job-form.ts';
import {
  type Identity,
  type Location,
  assertMayWrite,
  assertReplaceable,
  assertUnclaimed,
  assertValid,
  checkPlistWrite,
  locate,
  plistWriteOptions,
  preflight,
  refuse,
} from './job-preflight.ts';
import { type ServiceStatus, bootoutIfLoaded, bootstrap, printService } from './launchctl.ts';
import type { HostRunner } from './runner.ts';

const attributesOf = (
  props: Identity,
  location: Location,
  plistSha256: string,
  status: ServiceStatus,
): LaunchdJobAttributes => ({
  domain: props.domain,
  label: props.label,
  loaded: status.loaded,
  plistPath: location.plistPath,
  plistSha256,
  serviceTarget: location.target,
  ...(status.state === undefined ? {} : { state: status.state }),
  ...(status.pid === undefined ? {} : { pid: status.pid }),
  ...(status.lastExitCode === undefined ? {} : { lastExitCode: status.lastExitCode }),
});

/** What is on the host now: the plist's digest and launchd's view. `undefined` when neither exists. */
export const readJob = async (
  runner: HostRunner,
  props: Identity,
): Promise<LaunchdJobAttributes | undefined> => {
  const location = await locate(runner, props);
  const bytes = await runner.readFile(location.plistPath);
  const status = await printService(runner, location.target);
  if (bytes === undefined && !status.loaded) return undefined;
  return attributesOf(props, location, bytes === undefined ? '' : sha256Hex(bytes), status);
};

/**
 * ★ `deleteFirst`: labels are unique per domain, and the old and new job would otherwise run the
 *   same program side by side — same port, same files — until the old one is deleted. A brief
 *   outage beats two copies. ⛔ Which is why everything the new job's reconcile would refuse is
 *   refused HERE, at plan time (job-preflight.ts): after the delete it would be too late.
 * `full` is the whole declaration when resolved; job.ts passes only the identity otherwise.
 */
export const replaceDiff = async (
  runner: HostRunner,
  next: Identity,
  full: LaunchdJobProps | undefined,
  output: LaunchdJobAttributes,
): Promise<Diff> => {
  // ★ Validate before rendering, so a bad declaration shows its whole list, not a render error.
  if (full !== undefined) assertValid(full);
  const rendered = full === undefined ? undefined : renderJob(full).sha256;
  await assertReplaceable(runner, next, full, output, rendered);
  return { action: 'replace', deleteFirst: true };
};

export const diffJob = async (
  runner: HostRunner,
  news: LaunchdJobProps,
  output: LaunchdJobAttributes,
): Promise<Diff> => {
  if (news.label !== output.label || news.domain !== output.domain) {
    return replaceDiff(runner, news, news, output);
  }
  assertValid(news);
  const desired = renderJob(news).sha256;
  // ★ A plan that will write the plist asks the runner first (checkPlistWrite, HostRunner.checkWrite).
  const update = async (): Promise<Diff> => {
    await checkPlistWrite(runner, await locate(runner, news));
    return { action: 'update' };
  };
  // ⛔ BOTH digests: the stored one catches a bootstrap that failed after the write landed, the live
  //   one catches a hand edit. Either alone would report `noop` over a job that is not what we say.
  if (desired !== output.plistSha256) return update();
  const live = await readJob(runner, news);
  if (live === undefined || !live.loaded || live.plistSha256 !== desired) return update();
  return { action: 'noop' };
};

/**
 * `adopt` is what `--adopt` / `adopt(…)` resolve to for this resource (ownership/adopt.ts): it lets
 * a CREATE take over a job already on the host, as the plan's probe would have. A rename onto an
 * occupied label stays refused, as it is at plan time (assertReplaceable).
 */
export const reconcileJob = async (
  runner: HostRunner,
  props: LaunchdJobProps,
  output: LaunchdJobAttributes | undefined,
  adopt = false,
): Promise<LaunchdJobAttributes> => {
  assertValid(props);
  const { location, status } = await preflight(runner, props);
  const rendered = renderJob(props);
  /**
   * ⚠️ AN `output` UNDER ANOTHER LABEL OR DOMAIN means the engine planned an UPDATE across a rename —
   *   which it does whenever diff could not see the rename (a label that was itself an unresolved
   *   Output at plan time; job.ts). Bootstrapping the new label alone would orphan the old job,
   *   still running, with nothing left in state to ever remove it. So do what the replace would
   *   have done: every check above first, then delete the old job, then create the new one.
   */
  const renamed =
    output !== undefined && (output.label !== props.label || output.domain !== props.domain);
  const prior = renamed ? undefined : output;
  // ⛔ No prior state for THIS identity: whatever is there already belongs to someone else —
  //   unless adoption is on for a create, where the probe was skipped (a prop still an Output).
  if (prior === undefined && !(adopt && output === undefined)) {
    await assertUnclaimed(runner, props.label, location, status, rendered.sha256);
  }
  if (renamed) await deleteJob(runner, output);
  const before = await runner.readFile(location.plistPath);
  // ★ Already converged (a retried deploy, or an adopted job that matches): do not restart it.
  // ⛔ The STORED digest is part of the test: a write that landed before a failed bootout leaves
  //   the new plist on disk and the OLD job loaded — both look right, and only state knows better.
  if (
    status.loaded &&
    before !== undefined &&
    sha256Hex(before) === rendered.sha256 &&
    prior?.plistSha256 === rendered.sha256
  ) {
    return attributesOf(props, location, rendered.sha256, status);
  }
  // ⚠️ Owner and mode are launchd's rule, not a choice: see plistWriteOptions (job-preflight.ts).
  await runner.writeFileAtomic(
    location.plistPath,
    rendered.bytes,
    plistWriteOptions(location.domain),
  );
  await bootoutIfLoaded(runner, location.target);
  const failed = async (detail: string): Promise<never> => {
    // ⚠️ A failed removal must not replace the bootstrap error, nor let the message claim it worked.
    const removed =
      before === undefined &&
      (await runner.removeFile(location.plistPath).then(
        () => true,
        () => false,
      ));
    throw refuse(
      props.label,
      removed
        ? `bootstrap failed, so the job is NOT RUNNING; the plist this deploy wrote was removed ` +
            `again, so the next deploy starts clean. ${detail}`
        : `bootstrap failed, so the job is NOT RUNNING; the new plist is at ${location.plistPath} ` +
            `and the next deploy retries. ${detail}`,
    );
  };
  try {
    await bootstrap(runner, props.domain, location.plistPath);
  } catch (cause) {
    return failed(cause instanceof Error ? cause.message : String(cause));
  }
  const after = await printService(runner, location.target);
  if (!after.loaded) return failed('bootstrap exited 0 but launchctl print cannot find the job');
  return attributesOf(props, location, rendered.sha256, after);
};

/** Boot out, then remove the plist. Idempotent: an absent job and an absent file are success. */
export const deleteJob = async (
  runner: HostRunner,
  output: LaunchdJobAttributes,
): Promise<void> => {
  const domain = parseDomain(output.domain);
  if (domain === undefined) throw refuse(output.label, `unknown domain ${output.domain}`);
  assertMayWrite(runner, output.label, domain);
  // ★ A gui domain with no login session reads as "not loaded" (launchctl.ts), so the plist is
  //   still removed — which is what stops launchd loading it again at that user's next login.
  await bootoutIfLoaded(runner, output.serviceTarget);
  await runner.removeFile(output.plistPath);
};
