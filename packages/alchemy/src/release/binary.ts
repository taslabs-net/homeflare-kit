/**
 * `Release.Binary` — one binary out of a pinned release archive, written onto a host and verified
 * twice: the archive against its pinned SHA-256, then the binary against its own.
 *
 * - reconcile — validate every prop; download the archive by its exact URL; verify it; unpack ONLY
 *   the declared member; verify that; write it atomically through the HostRunner; read it back. A
 *   file already holding the pinned bytes is never downloaded again.
 * - read — lstat plus the SHA-256 of the bytes; never runs the binary.
 * - diff — the pins, the path, then mode and owner against the live file (binary-diff.ts).
 * - replace — when the path moves (a new version is a new directory): create-before-delete.
 * - delete — removes the file, never the directory.
 *
 * ★ VENDOR-NEUTRAL. The pinned archive arrives as props, usually from a data set beside this
 *   (victoria.ts) through `catalogBinary()`; nothing here knows a vendor, a package or a version.
 * ⛔ IT INSTALLS; IT NEVER STARTS. No launchctl, no systemctl, no restart: the job that runs the
 *   binary is the stack's own `LaunchdJob`, which puts this resource's `path` in its argv so the
 *   engine installs first and restarts the job when the path moves.
 * ⚠️ NOTHING IS ADOPTED WITHOUT `--adopt`, AT PLAN OR AT APPLY: the probe reads a file already at
 *   the path as `Unowned` — even one holding exactly the pinned bytes (docs/ownership.md) — and
 *   where the probe never ran (a prop was an Output) reconcile refuses it the same way. With
 *   `--adopt`, a file holding the pinned bytes is recognised by its digest and taken over without
 *   a download. ⛔ A file with OTHER bytes is never adopted, `--adopt` or not: that would be an
 *   overwrite in place that the plan prints as `adopted` (binary-claim.ts, both halves).
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import { lift } from '../launchd/host-effect.ts';
import { HostRunnerService } from '../launchd/runner.ts';
import { adoptsAtApply } from '../ownership/adopt.ts';
import { noteUnfinished } from '../ownership/resume.ts';
import { diffBinary } from './binary-diff.ts';
import type { ReleaseBinaryAttributes, ReleaseBinaryProps } from './binary-form.ts';
import { deleteBinary, reconcileBinary, refreshBinary } from './binary-lifecycle.ts';
import { readWithoutState } from './binary-read.ts';
import { declaredPinProblems } from './declared-pins.ts';
import { type DownloadPolicy, httpFetchArchive, sharingInFlight } from './download.ts';

export type { ReleaseBinaryAttributes, ReleaseBinaryProps } from './binary-form.ts';

export interface ReleaseBinary extends Resource<
  'Release.Binary',
  ReleaseBinaryProps,
  ReleaseBinaryAttributes
> {}

/**
 * One binary from a pinned release archive, installed onto a host and verified against digests
 * the stack pins in code — the archive's, then the binary's own.
 *
 * ### Installing a binary
 *
 * The directory is declared first and passed by its `path`, which orders the two; the job that
 * runs the binary references the binary's `path`, which orders the job after it.
 *
 * **Example:**
 *
 * ```ts
 * const vmalertOf = { package: 'vmutils', version: '1.151.0', platform: 'darwin-arm64', binary: 'vmalert' };
 * const dir = yield* HostDirectory('vmutils-1.151.0', {
 *   path: catalogDirectory('/opt/example/bin', vmalertOf),
 *   mode: 0o755,
 * });
 * const vmalert = yield* ReleaseBinary('vmalert', {
 *   ...catalogBinary(VICTORIA_RELEASES, vmalertOf),
 *   directory: dir.path,
 * });
 * // LaunchdJob(…, { programArguments: [vmalert.path, '--httpListenAddr=127.0.0.1:8880'] })
 * ```
 *
 * @resource
 */
export const ReleaseBinary = Resource<ReleaseBinary>('Release.Binary');

/** Test seams — NOT on the barrel. Every caller outside tests uses the defaults. */
export type ReleaseBinaryInternals = { readonly download?: DownloadPolicy };

export const makeReleaseBinaryProvider = (internals: ReleaseBinaryInternals = {}) =>
  Provider.effect(
    ReleaseBinary,
    Effect.gen(function* () {
      const runner = yield* HostRunnerService;
      const client = yield* HttpClient.HttpClient;
      const fetch = sharingInFlight(httpFetchArchive(client, internals.download));
      return ReleaseBinary.Provider.of({
        list: () => Effect.succeed([]),

        // ⛔ The probe (no `output`) validates every prop first, so a malformed pin fails the plan
        //   here — before any host call, let alone a download. A recovery read never fails its
        //   caller (binary-read.ts): its props are the failed deploy's.
        read: ({ fqn, instanceId, olds, output }) =>
          output === undefined
            ? readWithoutState(runner, { fqn, instanceId, olds })
            : lift(() => refreshBinary(runner, output)),

        diff: ({ instanceId, news, olds, output }) =>
          output === undefined
            ? noteUnfinished(instanceId)
            : lift(() => diffBinary(runner, news, olds, output)),

        // ★ `--adopt` reaches the apply too: the probe never ran for a create with an Output prop.
        // ⛔ So do the pins AS DECLARED: `news` is resolved by now, and a first deploy is never
        //   diffed, so only the stack's own record can show a digest that was an Output.
        reconcile: ({ fqn, instanceId, news, olds, output, session }) =>
          Effect.gen(function* () {
            const declared = yield* declaredPinProblems(fqn);
            const adopt = yield* adoptsAtApply({ fqn, instanceId, output });
            return yield* lift(() =>
              reconcileBinary(runner, fetch, news, {
                adopt,
                declared,
                note: (message) => Effect.runPromise(session.note(message)),
                olds,
                output,
              }),
            );
          }),

        delete: ({ output }) => lift(() => deleteBinary(runner, output)),
      });
    }),
  );

/** The provider, as a stack uses it. It needs a HostRunnerService and an HttpClient. */
export const ReleaseBinaryProvider = () => makeReleaseBinaryProvider();
