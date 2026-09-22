/**
 * Systemd.Unit's read / diff / reconcile / delete as plain async functions over a HostRunner, so
 * the whole lifecycle runs against a fake host with no real systemd.
 *
 * ⛔ WHAT A DEPLOY DOES NOT DO — the rule this family was built around. It NEVER mass-restarts.
 *   A unit is restarted only when THIS resource's unit file changed, or when a digest the
 *   declaration itself listed in `restartOn` changed. A unit that is already running the content
 *   we declare is left strictly alone: no restart, no reload, not even a `start`. An estate rebuild
 *   must be able to reach a host that holds a vault, a UPS handler or a clock without bouncing
 *   them, and "the deploy ran" must never be a reason anything went down.
 * ★ THE ORDER IS WRITE, RELOAD, ENABLE, THEN START OR RESTART. systemd reads the unit file at
 *   `daemon-reload`, so writing it while the old unit runs changes nothing yet, and a write that
 *   fails leaves the old unit running rather than leaving nothing running.
 * ⚠️ A FAILED START LEAVES THE UNIT DOWN. On an update the new unit file stays and state keeps the
 *   previous digest, so the next deploy retries. On a CREATE the file this deploy wrote is removed
 *   and systemd reloaded again: left behind, the next plan's recovery read finds a unit with no
 *   state, reports it `Unowned`, and every later deploy demands `--adopt` for our own file.
 * ⛔ A MASKED UNIT IS SOMEONE'S DECISION, NOT DRIFT. `systemctl mask` survives reboots and makes
 *   start fail; unmasking here would silently overrule whoever masked it.
 */
import type { Diff } from 'alchemy/Diff';
import { type HostRunner, canActAsRoot } from '../launchd/runner.ts';
import {
  type SystemdUnitAttributes,
  type SystemdUnitProps,
  UNIT_WRITE,
  configDigest,
  digestOf,
  unitPathFor,
  unitProblems,
  unitText,
} from './unit-form.ts';
import { type UnitStatus, daemonReload, disableUnit, showUnit, stopUnit } from './systemctl.ts';
import { attributesOf, refuse, settle } from './unit-settle.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Throw every refusal at once, so one plan shows the whole list. */
export const assertValid = (props: SystemdUnitProps, expect?: string): void => {
  const found = unitProblems(props, expect);
  if (found.length > 0) throw refuse(props.name, found.join('; '));
};

/** What is on the host now: the unit file's digest and systemd's view. `undefined` when neither. */
export const readUnit = async (
  runner: HostRunner,
  props: SystemdUnitProps,
): Promise<SystemdUnitAttributes | undefined> => {
  const bytes = await runner.readFile(unitPathFor(props));
  const status = await showUnit(runner, props.name);
  if (bytes === undefined && !status.known) return undefined;
  return attributesOf(props, bytes === undefined ? '' : digestOf(decoder.decode(bytes)), status);
};

/** ⛔ Writing a unit file and driving systemd are root's, so refuse up front rather than mid-apply. */
export const assertMayWrite = (runner: HostRunner, name: string): void => {
  if (canActAsRoot(runner)) return;
  throw refuse(
    name,
    'a systemd unit is root-owned and systemctl needs root. Point the runner at a destination ' +
      'whose ssh user is root, or provide a privileged HostRunner. This provider never calls sudo.',
  );
};

const assertUsable = (name: string, status: UnitStatus): void => {
  if (status.loadState === 'masked' || status.unitFileState === 'masked') {
    throw refuse(
      name,
      'is masked. If that is stale, `systemctl unmask` it deliberately, then redeploy. Nothing ' +
        'was written.',
    );
  }
};

/**
 * PLAN TIME, for the one shape a refusal cannot afford to be late for: the NAME a rename moves to.
 *
 * 🔴 A RENAME IS `deleteFirst`. Alchemy stops, disables and REMOVES the old unit before it
 *   reconciles the new one, so every check that ran only in `reconcileUnit` arrived with the
 *   service already down — and then refused, leaving nothing running and a plan that had promised
 *   a swap. The launchd family solved exactly this in job-preflight.ts `assertReplaceable`; this is
 *   the same answer for systemd. Read-only: `systemctl show`, a `readFile` and the runner's own
 *   pre-write refusals.
 * ⛔ `--adopt` CANNOT RESCUE IT EITHER, which is why refusing here changes no working case: a fresh
 *   replace's new generation is never adoptable (ownership/adopt.ts), so the identical refusal in
 *   `reconcileUnit` was always going to fire — just after the old unit was gone.
 */
export const assertRenameTarget = async (runner: HostRunner, name: string): Promise<void> => {
  assertMayWrite(runner, name);
  assertUsable(name, await showUnit(runner, name));
};

/** `assertRenameTarget`, plus the unit file the rename would land on. */
export const assertReplaceable = async (
  runner: HostRunner,
  props: SystemdUnitProps,
): Promise<void> => {
  await assertRenameTarget(runner, props.name);
  const path = unitPathFor(props);
  const before = await runner.readFile(path);
  // ★ A byte-identical file is this declaration's own leftover, not someone else's unit.
  if (before !== undefined && digestOf(decoder.decode(before)) !== digestOf(unitText(props))) {
    throw refuse(
      props.name,
      `${path} is already on this host and is not this resource. Nothing was removed. Remove it, ` +
        'or declare it as a new resource and deploy with --adopt.',
    );
  }
  await runner.checkWrite?.(path, UNIT_WRITE);
};

export const diffUnit = async (
  runner: HostRunner,
  news: SystemdUnitProps,
  output: SystemdUnitAttributes,
  expect?: string,
): Promise<Diff> => {
  assertValid(news, expect);
  // ★ The unit's name or its directory is its identity on the host: a change is a replace, and
  //   delete-first, because two unit files for one name cannot both be the one systemd reads.
  if (news.name !== output.name || unitPathFor(news) !== output.unitPath) {
    await assertReplaceable(runner, news);
    return { action: 'replace', deleteFirst: true };
  }
  const desired = digestOf(unitText(news));
  const update = async (): Promise<Diff> => {
    assertMayWrite(runner, news.name);
    await runner.checkWrite?.(unitPathFor(news), UNIT_WRITE);
    return { action: 'update' };
  };
  // ⛔ BOTH digests: the stored one catches a start that failed after the write landed, the live
  //   one catches a hand edit. Either alone reports `noop` over a unit that is not what we say.
  if (desired !== output.unitSha256) return update();
  if (configDigest(news.restartOn) !== output.configSha256) return update();
  const live = await readUnit(runner, news);
  if (live === undefined || live.unitSha256 !== desired) return update();
  if (live.enabled !== (news.enabled !== false)) return update();
  if (live.active !== (news.started !== false)) return update();
  // ⚠️ systemd's own word for "the file on disk is newer than what I loaded" — a write that landed
  //   without its reload. It is drift that neither digest can see.
  const status = await showUnit(runner, news.name);
  return status.needDaemonReload ? update() : { action: 'noop' };
};

/**
 * `adopt` is whether adoption is on AND this apply is a create or an unfinished generation of our
 * own (ownership/adopt.ts): it lets such a generation take over a unit already on the host.
 * ★ AN ADOPTED UNIT THAT ALREADY MATCHES IS NOT RESTARTED. That is the whole point of adopting one:
 *   the estate's live services come under declaration without a single bounce.
 */
export const reconcileUnit = async (
  runner: HostRunner,
  props: SystemdUnitProps,
  output: SystemdUnitAttributes | undefined,
  adopt = false,
  expect?: string,
): Promise<SystemdUnitAttributes> => {
  assertValid(props, expect);
  assertMayWrite(runner, props.name);
  const path = unitPathFor(props);
  const status = await showUnit(runner, props.name);
  assertUsable(props.name, status);
  const text = unitText(props);
  const desired = digestOf(text);
  const before = await runner.readFile(path);
  const liveSha = before === undefined ? undefined : digestOf(decoder.decode(before));
  const moved = output !== undefined && (output.name !== props.name || output.unitPath !== path);
  const prior = moved ? undefined : output;
  /**
   * ⛔ A UNIT THIS RESOURCE DOES NOT OWN IS NEVER OVERWRITTEN. Where the engine's probe never
   *   looked — a replace's new name, a create whose props were still an Output at plan time — a
   *   unit file already there with other content belongs to someone else, and writing ours over it
   *   would take their service. ★ A byte-identical file is this declaration's own leftover.
   */
  if (
    prior === undefined &&
    !(adopt && output === undefined) &&
    liveSha !== undefined &&
    liveSha !== desired
  ) {
    throw refuse(
      props.name,
      `${path} is already on this host and is not this resource. Remove it, or declare it as a ` +
        'new resource and deploy with --adopt.',
    );
  }
  if (moved && output !== undefined) await deleteUnit(runner, output);
  const wrote = liveSha !== desired;
  /**
   * ⛔ THE THREE THINGS THAT EARN A RESTART, and nothing else:
   *   - the unit file's bytes changed (`wrote`);
   *   - state holds an older digest than the file does — a previous deploy's write landed and its
   *     reload or restart never ran, so systemd is still running the old content;
   *   - systemd itself says its loaded unit is older than the file (`NeedDaemonReload`, measured);
   *   - a digest the declaration listed in `restartOn` changed.
   * ★ An adopted, converged unit hits none of them, which is why adoption never bounces a service.
   */
  const stale = prior !== undefined && prior.unitSha256 !== desired;
  const configChanged = prior !== undefined && prior.configSha256 !== configDigest(props.restartOn);
  if (wrote) await runner.writeFileAtomic(path, encoder.encode(text), UNIT_WRITE);
  if (wrote || status.needDaemonReload) await daemonReload(runner);
  const changed = wrote || stale || status.needDaemonReload;
  return settle(runner, props, { before, changed, configChanged, desired, path, status });
};

/**
 * Stop, disable, remove the unit file, reload. Idempotent.
 * ⛔ DELETING THE DECLARATION STOPS THE SERVICE. That is what removing it from the stack means, and
 *   it is why a unit that must outlive its declaration is adopted rather than deleted.
 */
export const deleteUnit = async (
  runner: HostRunner,
  output: SystemdUnitAttributes,
): Promise<void> => {
  assertMayWrite(runner, output.name);
  const status = await showUnit(runner, output.name);
  if (status.activeState === 'active' || status.activeState === 'activating') {
    await stopUnit(runner, output.name);
  }
  if (status.unitFileState === 'enabled' || status.unitFileState === 'enabled-runtime') {
    await disableUnit(runner, output.name);
  }
  const stat = await runner.stat(output.unitPath);
  if (stat !== undefined) {
    if (stat.kind !== 'file') throw refuse(output.name, `${output.unitPath} is a ${stat.kind}`);
    await runner.removeFile(output.unitPath);
  }
  await daemonReload(runner);
};
