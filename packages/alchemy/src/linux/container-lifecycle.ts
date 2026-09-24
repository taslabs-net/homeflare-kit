/**
 * `Podman.Container`'s read / diff / reconcile / delete as plain async functions over a
 * HostRunner — same split as `unit-lifecycle.ts`, so the whole lifecycle runs against a fake host
 * (fake-quadlet.ts) with no real systemd or Podman.
 *
 * ⛔ WHAT A DEPLOY DOES NOT DO — same rule `Systemd.Unit` was built around (unit-lifecycle.ts
 *   header): it NEVER mass-restarts. A container is restarted only when THIS resource's rendered
 *   `.container` file changed, or a digest the declaration listed in `restartOn` changed.
 * ★ THE ORDER IS WRITE, RELOAD, VERIFY THE GENERATOR, THEN START OR RESTART. `daemon-reload` is
 *   where Quadlet turns the `.container` file into `<name>.service` (container-generator.ts) —
 *   writing it changes nothing on its own, and a write that fails leaves the old file (and its
 *   already-generated unit) exactly as they were.
 * ⛔ A GENERATOR FAILURE IS ROLLED BACK, NOT LEFT FOR THE NEXT DEPLOY. `container-generator.ts`'s
 *   header explains why: `daemon-reload` deletes ALL generator output before regenerating, so a
 *   `.container` file the generator refuses has NO generated unit at all, even if the file it
 *   replaced generated one fine. An UPDATE that fails verification restores the previous file and
 *   reloads again, so the container this resource already promised running never loses its unit; a
 *   CREATE that fails removes the file it wrote, same as `Systemd.Unit`'s undo.
 * ⛔ NO ENABLE/DISABLE — see container-generator.ts and container-settle.ts headers.
 */
import type { Diff } from 'alchemy/Diff';
import type { HostRunner } from '../launchd/runner.ts';
import { UNIT_WRITE, isUnitRunning } from './unit-form.ts';
import { daemonReload, showUnit, stopUnit } from './systemctl.ts';
import { verifyGenerated } from './container-generator.ts';
import {
  type ContainerAttributes,
  type ContainerProps,
  configDigest,
  containerPathFor,
  digestOf,
  refuseContainer,
  renderContainerFile,
  serviceNameFor,
} from './container-form.ts';
import {
  assertMayWrite,
  assertReplaceable,
  assertUsable,
  assertValid,
} from './container-preflight.ts';
import { attributesOf, settle } from './container-settle.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** What is on the host now: the `.container` file's digest and the GENERATED unit's status. */
export const readContainer = async (
  runner: HostRunner,
  props: ContainerProps,
): Promise<ContainerAttributes | undefined> => {
  const path = containerPathFor(props);
  const bytes = await runner.readFile(path);
  const status = await showUnit(runner, serviceNameFor(props));
  if (bytes === undefined && !status.known) return undefined;
  const sha = bytes === undefined ? '' : digestOf(decoder.decode(bytes));
  return attributesOf(
    props,
    configDigest(props.restartOn),
    sha,
    path,
    serviceNameFor(props),
    status,
  );
};

export const diffContainer = async (
  runner: HostRunner,
  news: ContainerProps,
  output: ContainerAttributes,
): Promise<Diff> => {
  assertValid(news);
  // ★ The name or directory is the `.container` file's identity: a change is delete-first, same
  //   reason as `Systemd.Unit` (unit-lifecycle.ts diffUnit) — two files for one name can never
  //   both be the one Quadlet reads, and here also never both generate the same `.service`.
  if (news.name !== output.name || containerPathFor(news) !== output.containerPath) {
    await assertReplaceable(runner, news, output);
    return { action: 'replace', deleteFirst: true };
  }
  const desired = digestOf(renderContainerFile(news));
  const update = async (): Promise<Diff> => {
    assertMayWrite(runner, news.name);
    await runner.checkWrite?.(containerPathFor(news), UNIT_WRITE);
    return { action: 'update' };
  };
  if (desired !== output.containerSha256) return update();
  if (configDigest(news.restartOn) !== output.configSha256) return update();
  const live = await readContainer(runner, news);
  if (live === undefined || live.containerSha256 !== desired) return update();
  const status = await showUnit(runner, serviceNameFor(news));
  const wantStarted = news.started !== false;
  if (isUnitRunning(status.activeState, status.subState, wantStarted) !== wantStarted)
    return update();
  return status.needDaemonReload ? update() : { action: 'noop' };
};

/**
 * `adopt` is whether adoption is on AND this apply is a create or an unfinished generation of our
 * own — same meaning as `Systemd.Unit`'s (unit-lifecycle.ts reconcileUnit).
 */
export const reconcileContainer = async (
  runner: HostRunner,
  props: ContainerProps,
  output: ContainerAttributes | undefined,
  adopt = false,
): Promise<ContainerAttributes> => {
  assertValid(props);
  assertMayWrite(runner, props.name);
  const path = containerPathFor(props);
  const serviceName = serviceNameFor(props);
  const text = renderContainerFile(props);
  const desired = digestOf(text);
  const before = await runner.readFile(path);
  const liveSha = before === undefined ? undefined : digestOf(decoder.decode(before));
  const moved =
    output !== undefined && (output.name !== props.name || output.containerPath !== path);
  if (moved && output !== undefined) await assertReplaceable(runner, props, output);
  const prior = moved ? undefined : output;
  if (
    prior === undefined &&
    !(adopt && output === undefined) &&
    liveSha !== undefined &&
    liveSha !== desired
  ) {
    throw refuseContainer(
      props.name,
      `${path} is already on this host and is not this resource. Remove it, or declare it as a ` +
        'new resource and deploy with --adopt.',
    );
  }
  if (moved && output !== undefined) await deleteContainer(runner, output);
  const wrote = liveSha !== desired;
  /**
   * ⛔ MUST GATE THE RELOAD, NOT ONLY THE RESTART — found on adversarial review. `wrote` and
   *   `preStatus.needDaemonReload` both describe the GENERATED `<name>.service`'s own staleness;
   *   neither can see that the SOURCE `.container` file was written by an apply that then crashed
   *   (ssh drop, reboot) before its `daemon-reload` ran. On the retry: the file already holds
   *   `desired` (`wrote` is false), and systemd's own flag is unset because the generated unit —
   *   still built from the OLD content — hasn't changed either. Without `stale` here, no reload
   *   happens, `verifyGenerated` passes against that stale generation, and `settle` (below) would
   *   restart the container onto its OLD definition while returning `containerSha256: desired` —
   *   state then claims the new declaration took effect, permanently and silently, since every
   *   later diff compares state to itself. `stale` is exactly "the file's content no longer matches
   *   what THIS resource last recorded as generated", which is the one signal that catches it.
   *   Test: container-generator.test.ts, "an interrupted apply that crashed before daemon-reload".
   */
  const stale = prior !== undefined && prior.containerSha256 !== desired;
  const preStatus = await showUnit(runner, serviceName);
  assertUsable(props, preStatus);
  const needsReload = wrote || stale || preStatus.needDaemonReload;
  if (wrote) await runner.writeFileAtomic(path, encoder.encode(text), UNIT_WRITE);
  if (needsReload) await daemonReload(runner);
  const status = needsReload ? await showUnit(runner, serviceName) : preStatus;
  try {
    verifyGenerated(props.name, path, serviceName, status);
  } catch (cause) {
    // ⛔ Only a WRITE this reconcile made is worth rolling back — see file header. A file already
    //   on disk before this reconcile ran (wrote === false) generated nothing NEW to restore to.
    if (wrote) {
      if (before === undefined) await runner.removeFile(path).catch(() => undefined);
      else await runner.writeFileAtomic(path, before, UNIT_WRITE).catch(() => undefined);
      await daemonReload(runner).catch(() => undefined);
    }
    throw cause;
  }
  const configChanged = prior !== undefined && prior.configSha256 !== configDigest(props.restartOn);
  const changed = wrote || stale || preStatus.needDaemonReload;
  return settle(runner, props, configDigest(props.restartOn), {
    before,
    changed,
    configChanged,
    desired,
    path,
    serviceName,
    status,
  });
};

/**
 * Stop, remove the `.container` file, reload — clearing the orphaned generated unit. Idempotent.
 * No `disableUnit`: never enabled through systemctl in the first place (container-settle.ts).
 */
export const deleteContainer = async (
  runner: HostRunner,
  output: ContainerAttributes,
): Promise<void> => {
  assertMayWrite(runner, output.name);
  const status = await showUnit(runner, output.serviceName);
  if (status.activeState === 'active' || status.activeState === 'activating') {
    await stopUnit(runner, output.serviceName);
  }
  const stat = await runner.stat(output.containerPath);
  if (stat !== undefined) {
    if (stat.kind !== 'file')
      throw refuseContainer(output.name, `${output.containerPath} is a ${stat.kind}`);
    await runner.removeFile(output.containerPath);
  }
  await daemonReload(runner);
};
