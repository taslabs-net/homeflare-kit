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
 * ⚠️ NOTHING IS ADOPTED WITHOUT `--adopt`: a file already at the path reads as `Unowned`.
 * ★ IT LIVES IN THE launchd SUBPATH because the two travel together: a Mac host stack declares a
 *   daemon's config file and the daemon that reads it, through the same HostRunner.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { lift } from './host-effect.ts';
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

        diff: ({ news, output }) =>
          output === undefined || !isResolved(news)
            ? Effect.succeed(undefined)
            : lift(() => diffFile(runner, news, output)),

        reconcile: ({ news }) => lift(() => reconcileFile(runner, news)),

        delete: ({ output }) => lift(() => deleteFile(runner, output)),
      });
    }),
  );
