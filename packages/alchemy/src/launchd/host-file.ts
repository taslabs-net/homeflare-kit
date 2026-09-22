/**
 * `Host.File` — one text file on the host, declared: content, mode, owner, group.
 *
 * - create / update — atomic write (temp file in the same directory, mode and owner set, rename),
 *   skipped when the file already matches; then read back and compared.
 * - read — lstat plus the SHA-256 of the bytes.
 * - diff — declared SHA-256 against the stored and on-disk digest, plus mode and owner.
 * - replace — only when `path` changes; create-before-delete.
 * - delete — removes the file.
 *
 * ⛔ NEVER A SECRET — see host-file-form.ts. Secret files stay rendered by openbao-agent.
 * ⚠️ NOTHING IS ADOPTED WITHOUT `--adopt`: a file already at the path reads as `Unowned`, and where
 *   the plan never asked, reconcile refuses it unless adoption is on (docs/ownership.md).
 * ★ IT LIVES IN THE launchd SUBPATH because the two travel together: a Mac host stack declares a
 *   daemon's config file and the daemon that reads it, through the same HostRunner.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { adoptsAtApply } from '../ownership/adopt.ts';
import { noteUnfinished } from '../ownership/resume.ts';
import { lift, resolvedString } from './host-effect.ts';
import type { HostFileAttributes, HostFileProps } from './host-file-form.ts';
import { deleteFile, diffFile, readFileAttributes, reconcileFile } from './host-file-lifecycle.ts';
import { HostRunnerService } from './runner.ts';

export type { HostFileAttributes, HostFileProps } from './host-file-form.ts';

export interface HostFile extends Resource<'Host.File', HostFileProps, HostFileAttributes> {}

export const HostFile = Resource<HostFile>('Host.File');

export const HostFileProvider = () =>
  Provider.effect(
    HostFile,
    Effect.gen(function* () {
      const runner = yield* HostRunnerService;
      return HostFile.Provider.of({
        list: () => Effect.succeed([]),

        read: ({ olds, output }) =>
          lift(async () => {
            const found = await readFileAttributes(runner, olds.path);
            if (found === undefined) return undefined;
            return output === undefined ? Unowned(found) : found;
          }),

        diff: ({ instanceId, news, output }) => {
          // ★ An unfinished generation of our own: `--adopt` may resume it (ownership/resume.ts).
          if (output === undefined) return noteUnfinished(instanceId);
          if (isResolved(news)) return lift(() => diffFile(runner, news, output));
          // ⛔ A new path is a replace even while `content` is unresolved (an Output templated in):
          //   the engine's default would be an update, which writes the new path and never
          //   removes the old one. reconcileFile also defends, for a path that is an Output.
          const path = resolvedString(news, 'path');
          return Effect.succeed(
            path !== undefined && path !== output.path ? { action: 'replace' as const } : undefined,
          );
        },

        // ★ `--adopt` reaches the apply too: the probe never ran for a create with an Output prop.
        //   ⛔ A create or an unfinished generation — never a fresh replace's, never offered it.
        reconcile: ({ fqn, instanceId, news, output }) =>
          Effect.flatMap(adoptsAtApply({ fqn, instanceId, output }), (adopt) =>
            lift(() => reconcileFile(runner, news, output, adopt)),
          ),

        delete: ({ output }) => lift(() => deleteFile(runner, output)),
      });
    }),
  );
