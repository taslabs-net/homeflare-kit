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
import {
  type ReleaseBinaryAttributes,
  type ReleaseBinaryProps,
  releaseBinaryPath,
} from './binary-form.ts';
import {
  NOTHING,
  deleteBinary,
  reconcileBinary,
  refreshBinary,
  refuse,
} from './binary-lifecycle.ts';
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
      /**
       * ⛔ ONE PATH, ONE DECLARATION. MEASURED 2026-09-22 (binary-claims.test.ts, before this): two
       *   resources installing one path in one deploy both planned `create`, shared one download,
       *   and both recorded the file as theirs. Dropping either later — gating vmalert-logs off
       *   along with its own ReleaseBinary, say — deleted the file the other still declared, and
       *   that deploy reported the survivor `noop`. So a second resource claiming a path in the
       *   same run is refused before it touches anything. Two jobs that run one binary share ONE
       *   ReleaseBinary. ⚠️ Keyed by spelling: one file under two spellings is not caught here.
       */
      const claims = new Map<string, string>();
      const claim = (fqn: string, props: ReleaseBinaryProps): void => {
        const path = releaseBinaryPath(props);
        const holder = claims.get(path);
        if (holder !== undefined && holder !== fqn) {
          throw refuse(
            path,
            `is already installed by ${holder} in this deploy; declare each binary path once, ` +
              `and let every job that runs it share that one resource. ${NOTHING}`,
          );
        }
        claims.set(path, fqn);
      };
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
            return yield* lift(async () => {
              claim(fqn, news);
              return reconcileBinary(runner, fetch, news, {
                adopt,
                declared,
                note: (message) => Effect.runPromise(session.note(message)),
                olds,
                output,
              });
            });
          }),

        /**
         * ⛔ NEVER REMOVE A FILE ANOTHER DECLARATION INSTALLED IN THIS DEPLOY. Alchemy runs every
         *   delete (Apply.ts collectGarbage, Phase 2) only after every reconcile has succeeded, so a
         *   claim by another name means the file is that resource's now, verified as its pin.
         *   🔴 MEASURED 2026-09-22 (adopt-parity.test.ts): a rename under --adopt — the new name
         *   claimed the file, the old name's orphan delete removed it, and the deploy succeeded
         *   with the binary gone. ★ Left in place rather than removed: a stray file is a tidy-up, a
         *   missing binary is an outage. ⚠️ Keyed by spelling, like the claims themselves.
         * ★ A deleted resource gives its claim back, so a provider that outlives one deploy never
         *   refuses the next resource declared at that path.
         */
        delete: ({ fqn, output, session }) =>
          lift(async () => {
            const holder = claims.get(output.path);
            if (holder !== undefined && holder !== fqn) {
              await Effect.runPromise(
                session.note(`${output.path} was installed by ${holder} in this deploy; kept`),
              );
              return;
            }
            await deleteBinary(runner, output);
            if (holder === fqn) claims.delete(output.path);
          }),
      });
    }),
  );

/** The provider, as a stack uses it. It needs a HostRunnerService and an HttpClient. */
export const ReleaseBinaryProvider = () => makeReleaseBinaryProvider();
