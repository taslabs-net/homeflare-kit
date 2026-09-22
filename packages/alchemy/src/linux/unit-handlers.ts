/**
 * The four provider handlers `Systemd.Unit` and `Systemd.Timer` share, as plain functions over a
 * HostRunner — so the two Resources differ only in their TYPE and the unit suffix they insist on.
 *
 * ★ WHY NOT ONE SHARED HANDLER OBJECT. `Provider.of` is typed per Resource, so an object built once
 *   and passed to both would have to be widened or cast; functions with their arguments spelled out
 *   keep both call sites fully checked and still say each rule once.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import type { Diff } from 'alchemy/Diff';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import { lift, resolvedString } from '../launchd/host-effect.ts';
import type { HostRunner } from '../launchd/runner.ts';
import { adoptsAtApply } from '../ownership/adopt.ts';
import { noteUnfinished } from '../ownership/resume.ts';
import type { SystemdUnitAttributes, SystemdUnitProps } from './unit-form.ts';
import {
  assertRenameTarget,
  deleteUnit,
  diffUnit,
  readUnit,
  reconcileUnit,
} from './unit-lifecycle.ts';

export const readHandler = (
  runner: HostRunner,
  olds: SystemdUnitProps,
  output: SystemdUnitAttributes | undefined,
): Effect.Effect<SystemdUnitAttributes | undefined, Error> =>
  lift(async () => {
    const found = await readUnit(runner, olds);
    if (found === undefined) return undefined;
    return output === undefined ? Unowned(found) : found;
  });

export const diffHandler = (
  runner: HostRunner,
  instanceId: string,
  news: Input<SystemdUnitProps>,
  output: SystemdUnitAttributes | undefined,
  expect?: string,
): Effect.Effect<Diff | undefined, Error> => {
  // ★ An unfinished generation of our own: `--adopt` may resume it (ownership/resume.ts).
  if (output === undefined) return noteUnfinished(instanceId);
  if (isResolved(news)) return lift(() => diffUnit(runner, news, output, expect));
  /**
   * ⛔ A RENAME MUST BE SEEN EVEN WHILE OTHER PROPS ARE UNRESOLVED. The engine's default for a prop
   *   change is `update`, and an update under a new name writes the new unit file and leaves the old
   *   unit running with nothing in state to ever remove it. `content` is exactly what is unresolved
   *   when a rendered config file's digest is templated into the same deploy.
   */
  const name = resolvedString(news, 'name');
  if (name === undefined || name === output.name) return Effect.succeed(undefined);
  /**
   * ⛔ THE NAME IS ENOUGH TO REFUSE A MASKED TARGET, and the refusal has to happen here: the old
   *   unit is removed before the new one is reconciled. The unit file cannot be compared while
   *   `content` is still an Output, so this is the name-only half of assertReplaceable.
   */
  return lift(async () => {
    await assertRenameTarget(runner, name);
    return { action: 'replace' as const, deleteFirst: true };
  });
};

export const reconcileHandler = (
  runner: HostRunner,
  args: {
    fqn: string;
    instanceId: string;
    news: SystemdUnitProps;
    output: SystemdUnitAttributes | undefined;
  },
  expect?: string,
): Effect.Effect<SystemdUnitAttributes, Error> =>
  Effect.flatMap(adoptsAtApply(args), (adopt) =>
    lift(() => reconcileUnit(runner, args.news, args.output, adopt, expect)),
  );

export const deleteHandler = (
  runner: HostRunner,
  output: SystemdUnitAttributes,
): Effect.Effect<void, Error> => lift(() => deleteUnit(runner, output));
