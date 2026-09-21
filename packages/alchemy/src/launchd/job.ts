/**
 * `Launchd.Job` — one launchd job (a LaunchDaemon in `system`, a LaunchAgent in `gui/<uid>`),
 * declared rather than hand-loaded.
 *
 * ★ launchd HAS NO SDK. The provider renders the plist (plist.ts), writes it where launchd looks
 *   (job-form.ts plistPathFor), and drives `launchctl` (launchctl.ts) — all through the HostRunner
 *   the stack provides (runner.ts), so none of it is reachable except through that seam.
 *
 * Lifecycle (job-lifecycle.ts has the reasoning for each step):
 *   - create / update — write the plist atomically, boot out the old job if loaded, bootstrap.
 *     An update is therefore a RESTART; a converged job is left alone.
 *   - read — `launchctl print` (loaded? pid? last exit?) plus the plist's SHA-256.
 *   - diff — the rendered plist's SHA-256 against the stored AND the on-disk digest.
 *   - replace — only when `label` or `domain` changes, and DELETE FIRST (labels are unique); so
 *     everything the new job would be refused for is refused at plan time (job-preflight.ts).
 *   - delete — boot out, remove the plist.
 *
 * ⛔ ENVIRONMENT IS NON-SECRET ONLY — see the ⛔ on LaunchdJobProps.environment.
 * ⛔ NO SILENT SUDO — see assertMayWrite in job-preflight.ts.
 * ⚠️ NOTHING IS ADOPTED WITHOUT `--adopt`. A label already loaded, or a plist already on disk, reads
 *   as `Unowned`, so Alchemy refuses to take it over unless asked — and reconcile, where the plan
 *   never asked, honours the same `--adopt` / `adopt(…)` (docs/ownership.md). Labels under `org.nixos.`,
 *   `com.apple.` and `homebrew.mxcl.` are refused outright (job-validate.ts) — declare a new label
 *   and cut over instead (docs/launchd.md).
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { adoptsAtApply } from '../ownership/adopt.ts';
import { noteUnfinished } from '../ownership/resume.ts';
import { lift, resolvedString } from './host-effect.ts';
import type { LaunchdJobAttributes, LaunchdJobProps } from './job-form.ts';
import { deleteJob, diffJob, readJob, reconcileJob, replaceDiff } from './job-lifecycle.ts';
import { HostRunnerService } from './runner.ts';

export type {
  CalendarInterval,
  KeepAlive,
  LaunchdDomain,
  LaunchdJobAttributes,
  LaunchdJobProps,
} from './job-form.ts';

export interface LaunchdJob extends Resource<
  'Launchd.Job',
  LaunchdJobProps,
  LaunchdJobAttributes
> {}

export const LaunchdJob = Resource<LaunchdJob>('Launchd.Job');

export const LaunchdJobProvider = () =>
  Provider.effect(
    LaunchdJob,
    Effect.gen(function* () {
      const runner = yield* HostRunnerService;
      return LaunchdJob.Provider.of({
        /**
         * ⛔ launchd's job list is not a list of things this stack owns — it is every Apple, Nix
         *   and hand-loaded job on the host. Returning them would invite a nuke to boot them out.
         */
        list: () => Effect.succeed([]),

        read: ({ olds, output }) =>
          lift(async () => {
            const found = await readJob(runner, olds);
            if (found === undefined) return undefined;
            return output === undefined ? Unowned(found) : found;
          }),

        diff: ({ instanceId, news, output }) => {
          // ★ An unfinished generation of our own: `--adopt` may resume it (ownership/resume.ts).
          if (output === undefined) return noteUnfinished(instanceId);
          if (isResolved(news)) return lift(() => diffJob(runner, news, output));
          /**
           * ⛔ A RENAME MUST BE SEEN EVEN WHILE OTHER PROPS ARE UNRESOLVED. Returning undefined
           *   hands the call to the engine's default — `update` for any prop change (Plan.ts,
           *   havePropsChanged) — and an update under a new label bootstraps the new job and
           *   orphans the old one, still running. `config.path` in programArguments (the pattern
           *   docs/launchd.md recommends) is unresolved exactly when its HostFile changes in the
           *   same deploy. reconcileJob also defends against this, for a label that is itself an
           *   Output; seeing it here is what gets it planned as the replace it is.
           */
          const label = resolvedString(news, 'label');
          const domain = resolvedString(news, 'domain') as LaunchdJobProps['domain'] | undefined;
          return label !== undefined &&
            domain !== undefined &&
            (label !== output.label || domain !== output.domain)
            ? lift(() => replaceDiff(runner, { domain, label }, undefined, output))
            : Effect.succeed(undefined);
        },

        // ★ `--adopt` reaches the apply too: the probe never ran for a create with an Output prop.
        //   ⛔ A create or an unfinished generation — never a fresh replace's, never offered it.
        reconcile: ({ fqn, instanceId, news, output }) =>
          Effect.flatMap(adoptsAtApply({ fqn, instanceId, output }), (adopt) =>
            lift(() => reconcileJob(runner, news, output, adopt)),
          ),

        delete: ({ output }) => lift(() => deleteJob(runner, output)),
      });
    }),
  );
