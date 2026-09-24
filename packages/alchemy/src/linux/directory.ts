/**
 * `Host.Directory` — one directory on the host, declared: path, mode, owner, group.
 *
 * ⚠️ NOTHING IS ADOPTED WITHOUT `--adopt`: a directory already at the path reads as `Unowned`, and
 *   where the plan never asked, reconcile honours the same flag (docs/ownership.md).
 * ★ IT IS NOT LINUX-ONLY. It lives in the linux subpath because the gap it closes was found
 *   there (a first deploy into a new tree, which every file resource refuses to create).
 * ⚠️ mkdir AND rmdir TAKE `--` ON macOS. chmod AND chown DO NOT: measured 2026-09-24,
 *   `/bin/chmod` and `/usr/sbin/chown` treat `--` as a filename and exit 1. The lifecycle
 *   omits that token for those two on Darwin.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { lift, resolvedString } from '../launchd/host-effect.ts';
import { HostRunnerService } from '../launchd/runner.ts';
import { adoptsAtApply } from '../ownership/adopt.ts';
import { noteUnfinished } from '../ownership/resume.ts';
import type { HostDirectoryAttributes, HostDirectoryProps } from './directory-lifecycle.ts';
import {
  deleteDirectory,
  diffDirectory,
  readDirectory,
  reconcileDirectory,
} from './directory-lifecycle.ts';

export type { HostDirectoryAttributes, HostDirectoryProps } from './directory-lifecycle.ts';

export interface HostDirectory extends Resource<
  'Host.Directory',
  HostDirectoryProps,
  HostDirectoryAttributes
> {}

export const HostDirectory = Resource<HostDirectory>('Host.Directory');

export const HostDirectoryProvider = () =>
  Provider.effect(
    HostDirectory,
    Effect.gen(function* () {
      const runner = yield* HostRunnerService;
      return HostDirectory.Provider.of({
        list: () => Effect.succeed([]),

        read: ({ olds, output }) =>
          lift(async () => {
            const found = await readDirectory(runner, olds.path);
            if (found === undefined) return undefined;
            return output === undefined ? Unowned(found) : found;
          }),

        diff: ({ instanceId, news, output }) => {
          if (output === undefined) return noteUnfinished(instanceId);
          if (isResolved(news)) return lift(() => diffDirectory(runner, news, output));
          // ⛔ A new path is a replace even while the rest is unresolved: the engine's default
          //   update would create the new directory and leave the old one behind forever.
          const path = resolvedString(news, 'path');
          return Effect.succeed(
            path !== undefined && path !== output.path ? { action: 'replace' as const } : undefined,
          );
        },

        reconcile: ({ fqn, instanceId, news, output }) =>
          Effect.flatMap(adoptsAtApply({ fqn, instanceId, output }), (adopt) =>
            lift(() => reconcileDirectory(runner, news, output, adopt)),
          ),

        delete: ({ output }) => lift(() => deleteDirectory(runner, output)),
      });
    }),
  );
