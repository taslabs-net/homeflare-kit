/**
 * `Victoria.Binary` — one VictoriaMetrics binary on a host, installed from the vendor's release
 * archive and verified twice against digests pinned in the kit (catalog.ts).
 *
 * - reconcile — refuse anything the catalog does not pin; download the archive; verify it; unpack
 *   ONLY the declared member; verify that; write it atomically through the HostRunner; read back.
 *   A file already holding the pinned bytes is never downloaded again.
 * - read — lstat plus the SHA-256 of the bytes; never runs the binary.
 * - diff — the pinned digest against state and the live file, plus mode and owner.
 * - replace — when the path changes (a new version is a new directory): create-before-delete.
 * - delete — removes the file, never the directory.
 *
 * ⛔ IT INSTALLS; IT NEVER STARTS. No launchctl, no systemctl, no restart: the job that runs the
 *   binary is the stack's own `LaunchdJob`, which puts this resource's `path` in its argv so the
 *   engine installs first and restarts the job when the path moves.
 * ⚠️ NOTHING IS ADOPTED WITHOUT `--adopt` AT PLAN: the probe reads a file already at the path as
 *   `Unowned` — even one holding exactly the pinned bytes (docs/ownership.md). With `--adopt`, such
 *   a file is recognised by its digest and taken over without a download.
 * ⚠️ AT APPLY, WHERE THE PLAN COULD NOT ASK (a prop was an Output, so Alchemy skipped the probe), a
 *   file with the pinned bytes, mode and owner is accepted as the resume of an interrupted install
 *   — Host.File's rule, shared in file-converge.ts. Anything else there is refused without
 *   `--adopt`. A deliberately identical file placed by another owner is therefore indistinguishable
 *   from our own half-finished create; declare each path once.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import { lift, resolvedString } from '../launchd/host-effect.ts';
import { HostRunnerService } from '../launchd/runner.ts';
import { adoptsAtApply } from '../ownership/adopt.ts';
import { noteUnfinished } from '../ownership/resume.ts';
import type { VictoriaBinaryAttributes, VictoriaBinaryProps } from './binary-form.ts';
import {
  deleteBinary,
  diffBinary,
  readBinary,
  reconcileBinary,
  refreshBinary,
} from './binary-lifecycle.ts';
import { VICTORIA_CATALOG, type VictoriaCatalog } from './catalog.ts';
import { type DownloadPolicy, httpFetchArchive, sharingInFlight } from './download.ts';
import { BinaryRefused } from './refused.ts';
import { releaseProblems } from './release.ts';

export type { VictoriaBinaryAttributes, VictoriaBinaryProps } from './binary-form.ts';

export interface VictoriaBinary extends Resource<
  'Victoria.Binary',
  VictoriaBinaryProps,
  VictoriaBinaryAttributes
> {}

/**
 * A VictoriaMetrics binary, installed from the vendor's release archive and verified against
 * digests pinned in the kit — the archive's, then the binary's own.
 *
 * ### Installing a binary
 *
 * The directory is declared first and passed by its `path`, which orders the two; the job that
 * runs the binary references the binary's `path`, which orders the job after it.
 *
 * **Example:**
 *
 * ```ts
 * const dir = yield* HostDirectory('vmutils-1.151.0', {
 *   path: victoriaDirectory('/opt/example/bin', 'vmutils', '1.151.0'),
 *   mode: 0o755,
 * });
 * const vmalert = yield* VictoriaBinary('vmalert', {
 *   directory: dir.path,
 *   package: 'vmutils',
 *   version: '1.151.0',
 *   platform: 'darwin-arm64',
 *   binary: 'vmalert',
 * });
 * // LaunchdJob(…, { programArguments: [vmalert.path, '--httpListenAddr=127.0.0.1:8880'] })
 * ```
 *
 * @resource
 */
export const VictoriaBinary = Resource<VictoriaBinary>('Victoria.Binary');

/** Test seams — NOT on the barrel. Every caller outside tests uses the defaults. */
export type VictoriaBinaryInternals = {
  readonly catalog?: VictoriaCatalog;
  readonly download?: DownloadPolicy;
};

const IDENTITY = ['package', 'version', 'binary'] as const;

export const makeVictoriaBinaryProvider = (internals: VictoriaBinaryInternals = {}) =>
  Provider.effect(
    VictoriaBinary,
    Effect.gen(function* () {
      const runner = yield* HostRunnerService;
      const client = yield* HttpClient.HttpClient;
      const catalog = internals.catalog ?? VICTORIA_CATALOG;
      const fetch = sharingInFlight(httpFetchArchive(client, internals.download));
      return VictoriaBinary.Provider.of({
        list: () => Effect.succeed([]),

        // ⛔ The probe (no `output`) validates the declaration first, so an unknown version fails
        //   the plan here — before a byte is fetched — whenever the props are resolved.
        read: ({ olds, output }) =>
          lift(async () => {
            if (output !== undefined) return refreshBinary(runner, output);
            const found = await readBinary(runner, olds, catalog);
            return found === undefined ? undefined : Unowned(found);
          }),

        diff: ({ instanceId, news, olds, output }) => {
          if (output === undefined) return noteUnfinished(instanceId);
          if (isResolved(news)) return lift(() => diffBinary(runner, news, output, catalog));
          return lift(async () => {
            // ⛔ The catalog refuses at plan even while `directory` is an Output: the four props
            //   that pick an archive are plain strings in any declaration that could resolve.
            const [pkg, version, platform, binary] = [
              'package',
              'version',
              'platform',
              'binary',
            ].map((key) => resolvedString(news, key));
            if (
              pkg !== undefined &&
              version !== undefined &&
              platform !== undefined &&
              binary !== undefined
            ) {
              const problems = releaseProblems(
                { binary, package: pkg, platform, version },
                catalog,
              );
              if (problems.length > 0) {
                throw new BinaryRefused({
                  message: `Victoria.Binary ${output.path}: ${problems.join('; ')}. Nothing was written.`,
                });
              }
            }
            // ⛔ A new package, version or binary is a new path (the directory ends in
            //   `<package>-<version>`), so a replace — even while the directory is unresolved.
            const moves = IDENTITY.some((key) => {
              const value = resolvedString(news, key);
              return value !== undefined && value !== olds[key];
            });
            const directory = resolvedString(news, 'directory');
            const elsewhere =
              directory !== undefined &&
              binary !== undefined &&
              `${directory}/${binary}` !== output.path;
            return moves || elsewhere ? { action: 'replace' as const } : undefined;
          });
        },

        // ★ `--adopt` reaches the apply too: the probe never ran for a create with an Output prop.
        reconcile: ({ fqn, instanceId, news, output, session }) =>
          Effect.flatMap(adoptsAtApply({ fqn, instanceId, output }), (adopt) =>
            lift(() =>
              reconcileBinary(runner, fetch, news, {
                adopt,
                catalog,
                note: (message) => Effect.runPromise(session.note(message)),
                output,
              }),
            ),
          ),

        delete: ({ output }) => lift(() => deleteBinary(runner, output)),
      });
    }),
  );

/** The provider, as a stack uses it. It needs a HostRunnerService and an HttpClient. */
export const VictoriaBinaryProvider = () => makeVictoriaBinaryProvider();
