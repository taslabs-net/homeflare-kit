/**
 * `Remote.File` — one text file on a Linux host, declared: content, mode, owner, group — or one
 * MANAGED BLOCK inside a file this resource does not own.
 *
 * - create / update — atomic write (stage beside the target, chown, chmod, rename), skipped when
 *   the host already says what we declare; then read back and compared.
 * - read — lstat plus the SHA-256 of the file and of the part this resource owns.
 * - diff — the declared digest against the stored AND the on-disk one, plus mode and owner.
 * - replace — only when `path` changes; create-before-delete.
 * - delete — removes the file, or in region mode only the block.
 *
 * ⛔ NEVER A SECRET — see remote-file-form.ts.
 * ⚠️ NOTHING IS ADOPTED WITHOUT `--adopt` (docs/ownership.md): a file already at the path, or a
 *   block already carrying the markers, reads as `Unowned`.
 * ★ IT IS A SEPARATE RESOURCE FROM `Host.File`, not a flag on it: the two have different attributes
 *   (a region name that a delete cannot work without) and different promises about the rest of the
 *   file, and folding them together would make every existing Mac HostFile's state shape change.
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
import type { RemoteFileAttributes, RemoteFileProps } from './remote-file-form.ts';
import {
  deleteFile,
  diffFile,
  readFileAttributes,
  reconcileFile,
} from './remote-file-lifecycle.ts';

export type { RemoteFileAttributes, RemoteFileProps } from './remote-file-form.ts';

export interface RemoteFile extends Resource<
  'Remote.File',
  RemoteFileProps,
  RemoteFileAttributes
> {}

export const RemoteFile = Resource<RemoteFile>('Remote.File');

export const RemoteFileProvider = () =>
  Provider.effect(
    RemoteFile,
    Effect.gen(function* () {
      const runner = yield* HostRunnerService;
      return RemoteFile.Provider.of({
        /** ⛔ A host's files are not a list of things this stack owns. */
        list: () => Effect.succeed([]),

        read: ({ olds, output }) =>
          lift(async () => {
            const found = await readFileAttributes(runner, olds.path, olds.region);
            if (found === undefined) return undefined;
            // ⛔ In region mode an existing file is NOT this resource: only the block is. A file
            //   with no such block reads as nothing, so the create writes the block instead of
            //   demanding --adopt for a file it was never claiming.
            if (olds.region !== undefined && found.contentSha256 === '') return undefined;
            return output === undefined ? Unowned(found) : found;
          }),

        diff: ({ instanceId, news, output }) => {
          // ★ An unfinished generation of our own: `--adopt` may resume it (ownership/resume.ts).
          if (output === undefined) return noteUnfinished(instanceId);
          if (isResolved(news)) return lift(() => diffFile(runner, news, output));
          // ⛔ A new path is a replace even while `content` is unresolved (an Output templated in):
          //   the engine's default would be an update, which writes the new path and never removes
          //   the old one.
          const path = resolvedString(news, 'path');
          return Effect.succeed(
            path !== undefined && path !== output.path ? { action: 'replace' as const } : undefined,
          );
        },

        // ★ `--adopt` reaches the apply too: the probe never ran for a create with an Output prop.
        reconcile: ({ fqn, instanceId, news, output }) =>
          Effect.flatMap(adoptsAtApply({ fqn, instanceId, output }), (adopt) =>
            lift(() => reconcileFile(runner, news, output, adopt)),
          ),

        delete: ({ output }) => lift(() => deleteFile(runner, output)),
      });
    }),
  );
