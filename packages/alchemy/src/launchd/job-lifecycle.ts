/**
 * LaunchdJob's read / diff / reconcile / delete as plain async functions over a HostRunner — split
 * from job.ts so the whole lifecycle runs against fake-runner.ts in tests, with no real launchd.
 *
 * ★ THE ORDER IS WRITE, BOOTOUT, BOOTSTRAP — not bootout first. launchd reads the plist only at
 *   bootstrap, so writing the new file while the old job runs changes nothing yet, and a write that
 *   fails (disk full, EACCES) leaves the old job running instead of leaving nothing running.
 * ⚠️ A FAILED BOOTSTRAP LEAVES THE JOB DOWN, with the new plist on disk. The error says so, the
 *   state keeps the previous digest, and the next deploy therefore retries. There is no automatic
 *   rollback: a plist that launchd refuses is a declaration to fix, and re-bootstrapping the old one
 *   could just as easily fail for the same host-side reason (a disabled label, a bad owner).
 */
import type { Diff } from 'alchemy/Diff';
import {
  type LaunchdJobAttributes,
  type LaunchdJobProps,
  type ParsedDomain,
  parseDomain,
  plistPathFor,
  renderJob,
  serviceTarget,
  sha256Hex,
} from './job-form.ts';
import { jobProblems } from './job-validate.ts';
import {
  type ServiceStatus,
  bootoutIfLoaded,
  bootstrap,
  isDisabled,
  printService,
} from './launchctl.ts';
import { type HostRunner, canActAsRoot } from './runner.ts';

type Location = {
  readonly domain: ParsedDomain;
  readonly plistPath: string;
  readonly target: string;
};

const refuse = (label: string, message: string): Error =>
  new Error(`Launchd.Job ${label}: ${message}`);

/** Throw every refusal at once, so one plan shows the whole list. */
export const assertValid = (props: LaunchdJobProps): void => {
  const found = jobProblems(props);
  if (found.length > 0) throw refuse(props.label, found.join('; '));
};

const locate = async (
  runner: HostRunner,
  props: Pick<LaunchdJobProps, 'label' | 'domain'>,
): Promise<Location> => {
  const domain = parseDomain(props.domain);
  if (domain === undefined) throw refuse(props.label, `unknown domain ${props.domain}`);
  const home =
    domain.kind === 'gui' ? (await runner.lookupUser(String(domain.uid)))?.home : undefined;
  return {
    domain,
    plistPath: plistPathFor(props.label, domain, home),
    target: serviceTarget(props.label, props.domain),
  };
};

/**
 * ⛔ NO SILENT SUDO. The system domain, and another user's gui domain, need root. Refuse up front
 *   with the two ways out, rather than let launchctl or rename(2) fail halfway through.
 */
const assertMayWrite = (runner: HostRunner, label: string, domain: ParsedDomain): void => {
  if (canActAsRoot(runner)) return;
  if (domain.kind === 'system') {
    throw refuse(
      label,
      'the system domain needs root. Run the deploy as root, or provide a HostRunner that is ' +
        'deliberately privileged (privileged: true). This provider never calls sudo.',
    );
  }
  if (domain.uid !== runner.effectiveUid()) {
    throw refuse(
      label,
      `gui/${String(domain.uid)} belongs to another user; only root may write it. ` +
        'Deploy as that user, as root, or through a privileged HostRunner.',
    );
  }
};

const attributesOf = (
  props: Pick<LaunchdJobProps, 'label' | 'domain'>,
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
  props: Pick<LaunchdJobProps, 'label' | 'domain'>,
): Promise<LaunchdJobAttributes | undefined> => {
  const location = await locate(runner, props);
  const bytes = await runner.readFile(location.plistPath);
  const status = await printService(runner, location.target);
  if (bytes === undefined && !status.loaded) return undefined;
  return attributesOf(props, location, bytes === undefined ? '' : sha256Hex(bytes), status);
};

export const diffJob = async (
  runner: HostRunner,
  news: LaunchdJobProps,
  output: LaunchdJobAttributes,
): Promise<Diff> => {
  /**
   * ★ `deleteFirst`: labels are unique per domain, and the old and new job would otherwise run the
   *   same program side by side — same port, same files — until the old one is deleted. A brief
   *   outage beats two copies.
   */
  if (news.label !== output.label || news.domain !== output.domain) {
    return { action: 'replace', deleteFirst: true };
  }
  assertValid(news);
  const desired = renderJob(news).sha256;
  // ⛔ BOTH digests: the stored one catches a bootstrap that failed after the write landed, the live
  //   one catches a hand edit. Either alone would report `noop` over a job that is not what we say.
  if (desired !== output.plistSha256) return { action: 'update' };
  const live = await readJob(runner, news);
  if (live === undefined || !live.loaded || live.plistSha256 !== desired)
    return { action: 'update' };
  return { action: 'noop' };
};

export const reconcileJob = async (
  runner: HostRunner,
  props: LaunchdJobProps,
  output: LaunchdJobAttributes | undefined,
): Promise<LaunchdJobAttributes> => {
  assertValid(props);
  const location = await locate(runner, props);
  assertMayWrite(runner, props.label, location.domain);
  /**
   * ⛔ A DISABLED LABEL IS SOMEONE'S DECISION, NOT DRIFT. `launchctl disable` persists across boots
   *   and makes bootstrap fail; enabling it here would silently overrule whoever disabled it.
   */
  if (await isDisabled(runner, props.domain, props.label)) {
    throw refuse(
      props.label,
      `${location.target} is disabled (launchctl print-disabled ${props.domain}). ` +
        `If that is stale, run \`launchctl enable ${location.target}\` deliberately, then redeploy.`,
    );
  }
  const rendered = renderJob(props);
  const before = await runner.readFile(location.plistPath);
  const status = await printService(runner, location.target);
  // ★ Already converged (a retried deploy, or an adopted job that matches): do not restart it.
  if (
    status.loaded &&
    before !== undefined &&
    sha256Hex(before) === rendered.sha256 &&
    output?.plistSha256 === rendered.sha256
  ) {
    return attributesOf(props, location, rendered.sha256, status);
  }
  /**
   * ⚠️ launchd refuses a daemon plist that is not root:wheel or is group/world-writable ("bad
   *   ownership/permissions"), so the system domain always writes 0644 root:wheel. An agent's plist
   *   belongs to its user. REASONED from launchd's documented behaviour, not measured here (no
   *   bootstrap was run to write this); the nix-darwin daemons on the reference host are 0644 root.
   */
  await runner.writeFileAtomic(
    location.plistPath,
    rendered.bytes,
    location.domain.kind === 'system'
      ? { gid: 0, mode: 0o644, uid: 0 }
      : { mode: 0o644, uid: location.domain.uid },
  );
  await bootoutIfLoaded(runner, location.target);
  await bootstrap(runner, props.domain, location.plistPath).catch((cause: unknown) => {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw refuse(
      props.label,
      `bootstrap failed, so the job is NOT RUNNING; the new plist is at ${location.plistPath} ` +
        `and the next deploy retries. ${detail}`,
    );
  });
  const after = await printService(runner, location.target);
  if (!after.loaded) {
    throw refuse(props.label, 'bootstrap exited 0 but launchctl print cannot find the job');
  }
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
  await bootoutIfLoaded(runner, output.serviceTarget);
  await runner.removeFile(output.plistPath);
};
