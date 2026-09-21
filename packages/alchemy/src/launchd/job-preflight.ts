/**
 * Everything LaunchdJob checks before it touches the host — split from job-lifecycle.ts so that a
 * reconcile and a plan-time REPLACE run the very same checks.
 *
 * ★ WHY A REPLACE IS CHECKED AT PLAN TIME. A label or domain change is a delete-first replace, and
 *   Alchemy runs `delete` on the old job BEFORE `reconcile` on the new one (Apply.ts,
 *   deleteOldGenerations under `node.deleteFirst`; read in alchemy 2.0.0-beta.79 on 2026-09-21).
 *   A refusal that fired only in reconcile would therefore arrive after the old job was already
 *   booted out: nothing running, and a plan that had promised a clean swap.
 * ★ EVERY CHECK HERE IS READ-ONLY: validation, a user lookup, `launchctl print` and
 *   `print-disabled` — none of which needs root (measured, see launchctl.ts).
 */
import {
  type LaunchdJobAttributes,
  type LaunchdJobProps,
  type ParsedDomain,
  parseDomain,
  plistPathFor,
  serviceTarget,
  sha256Hex,
} from './job-form.ts';
import { identityProblems, jobProblems } from './job-validate.ts';
import { type ServiceStatus, isDisabled, printService } from './launchctl.ts';
import { type HostRunner, type WriteOptions, canActAsRoot } from './runner.ts';

export type Location = {
  readonly domain: ParsedDomain;
  readonly plistPath: string;
  readonly target: string;
};

export type Identity = Pick<LaunchdJobProps, 'label' | 'domain'>;

/**
 * ⚠️ launchd refuses a daemon plist that is not root:wheel or is group/world-writable ("bad
 *   ownership/permissions"), so the system domain always writes 0644 root:wheel. An agent's plist
 *   belongs to its user. REASONED from launchd's documented behaviour, not measured here (no
 *   bootstrap was run to write this); the nix-darwin daemons on the reference host are 0644 root.
 */
export const plistWriteOptions = (domain: ParsedDomain): WriteOptions =>
  domain.kind === 'system' ? { gid: 0, mode: 0o644, uid: 0 } : { mode: 0o644, uid: domain.uid };

/**
 * PLAN TIME, for a plan that will write the plist: the runner's own pre-write refusals
 * (HostRunner.checkWrite — sudoRunner's directory and mode checks), reading only.
 */
export const checkPlistWrite = async (runner: HostRunner, location: Location): Promise<void> =>
  runner.checkWrite?.(location.plistPath, plistWriteOptions(location.domain));

export const refuse = (label: string, message: string): Error =>
  new Error(`Launchd.Job ${label}: ${message}`);

/** Throw every refusal at once, so one plan shows the whole list. */
export const assertValid = (props: LaunchdJobProps): void => {
  const found = jobProblems(props);
  if (found.length > 0) throw refuse(props.label, found.join('; '));
};

export const locate = async (runner: HostRunner, props: Identity): Promise<Location> => {
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
export const assertMayWrite = (runner: HostRunner, label: string, domain: ParsedDomain): void => {
  if (canActAsRoot(runner)) return;
  if (domain.kind === 'system') {
    throw refuse(
      label,
      'the system domain needs root. Run the deploy as root, or pass a deliberately privileged ' +
        'HostRunner: sudoRunner() elevates exactly the calls this needs. This provider never ' +
        'calls sudo itself.',
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

/** Where the job goes, whether we may write it there, and launchd's current view of it. */
export const preflight = async (
  runner: HostRunner,
  props: Identity,
): Promise<{ location: Location; status: ServiceStatus }> => {
  const location = await locate(runner, props);
  assertMayWrite(runner, props.label, location.domain);
  const status = await printService(runner, location.target);
  if (status.domainMissing === true) {
    throw refuse(
      props.label,
      `${props.domain} does not exist: that user has no login session, and launchd creates a gui ` +
        'domain only at login. Log the user in (or declare a system-domain job with userName), ' +
        'then redeploy. Nothing was written.',
    );
  }
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
  return { location, status };
};

/**
 * ⛔ A JOB THIS RESOURCE DOES NOT OWN IS NEVER OVERWRITTEN. Alchemy's adoption probe guards a
 *   create, but NOT the new label of a replace — the engine reads nothing there — so a rename onto
 *   a label someone already loaded would boot their job out and write ours over its plist.
 * ★ A plist byte-identical to our render is exempt: it is this declaration's own leftover (a
 *   deploy that died between write and bootstrap), and rewriting it changes nothing.
 */
export const assertUnclaimed = async (
  runner: HostRunner,
  label: string,
  location: Location,
  status: ServiceStatus,
  renderedSha256: string | undefined,
): Promise<void> => {
  const bytes = await runner.readFile(location.plistPath);
  const foreignFile = bytes !== undefined && sha256Hex(bytes) !== renderedSha256;
  if (foreignFile || (bytes === undefined && status.loaded)) {
    throw refuse(
      label,
      `${location.target} is already on this host (${foreignFile ? location.plistPath : 'loaded'})` +
        ' and is not this resource. Remove it, or declare it as a new resource and deploy with ' +
        '--adopt.',
    );
  }
};

/**
 * A rename, checked at plan time: the new identity must be valid, writable, bootstrappable and
 * free, and the old one deletable — before the plan may promise a delete-first replace.
 * `full` is the whole declaration when it is already resolved; otherwise only the identity is.
 */
export const assertReplaceable = async (
  runner: HostRunner,
  next: Identity,
  full: LaunchdJobProps | undefined,
  old: LaunchdJobAttributes,
  renderedSha256: string | undefined,
): Promise<void> => {
  const found = full === undefined ? identityProblems(next.label, next.domain) : jobProblems(full);
  if (found.length > 0) throw refuse(next.label, found.join('; '));
  const oldDomain = parseDomain(old.domain);
  if (oldDomain === undefined) throw refuse(old.label, `unknown domain ${old.domain}`);
  assertMayWrite(runner, old.label, oldDomain);
  const { location, status } = await preflight(runner, next);
  await assertUnclaimed(runner, next.label, location, status, renderedSha256);
  await checkPlistWrite(runner, location);
};
