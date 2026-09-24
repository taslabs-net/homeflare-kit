/**
 * `Podman.Container`'s four provider handlers, as plain functions over a HostRunner — the same
 * split as `unit-handlers.ts`, so `container.ts`'s `Provider.of` stays a thin wire-up.
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
import type { ContainerAttributes, ContainerProps } from './container-form.ts';
import {
  deleteContainer,
  diffContainer,
  readContainer,
  reconcileContainer,
} from './container-lifecycle.ts';
import { assertRenameTarget } from './container-preflight.ts';

export const readHandler = (
  runner: HostRunner,
  olds: ContainerProps,
  output: ContainerAttributes | undefined,
): Effect.Effect<ContainerAttributes | undefined, Error> =>
  lift(async () => {
    const found = await readContainer(runner, olds);
    if (found === undefined) return undefined;
    return output === undefined ? Unowned(found) : found;
  });

export const diffHandler = (
  runner: HostRunner,
  instanceId: string,
  news: Input<ContainerProps>,
  output: ContainerAttributes | undefined,
): Effect.Effect<Diff | undefined, Error> => {
  // ★ An unfinished generation of our own: `--adopt` may resume it (ownership/resume.ts).
  if (output === undefined) return noteUnfinished(instanceId);
  if (isResolved(news)) return lift(() => diffContainer(runner, news, output));
  /**
   * ⛔ A RENAME MUST BE SEEN EVEN WHILE OTHER PROPS ARE UNRESOLVED — same reason as
   *   `unit-handlers.ts`'s `diffHandler`: the engine's default for a prop change is `update`, and
   *   an update under a new name writes the new `.container` file and leaves the old generated
   *   unit running with nothing in state to ever remove it.
   */
  const name = resolvedString(news, 'name');
  if (name === undefined || name === output.name) return Effect.succeed(undefined);
  return lift(async () => {
    await assertRenameTarget(runner, output, name);
    return { action: 'replace' as const, deleteFirst: true };
  });
};

export const reconcileHandler = (
  runner: HostRunner,
  args: {
    fqn: string;
    instanceId: string;
    news: ContainerProps;
    output: ContainerAttributes | undefined;
  },
): Effect.Effect<ContainerAttributes, Error> =>
  Effect.flatMap(adoptsAtApply(args), (adopt) =>
    lift(() => reconcileContainer(runner, args.news, args.output, adopt)),
  );

export const deleteHandler = (
  runner: HostRunner,
  output: ContainerAttributes,
): Effect.Effect<void, Error> => lift(() => deleteContainer(runner, output));
