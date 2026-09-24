/**
 * `declareRepoBaseline` — the house GitHub baseline (repo-baseline-data.ts), as resources.
 *
 *     const baseline = yield* declareRepoBaseline('api', {
 *       owner: 'taslabs-net',
 *       repository: 'api',
 *       checks: ['ci', 'secret scan'],
 *       visibility: 'private',
 *     });
 *
 * Provide `repoPolicyProviders()` (repository-ruleset-providers.ts) — this subpath ships no
 * provider of its own beyond the ruleset bridge, the same as `declareRepoPolicy`. Both resources
 * are `retain` and `adopt(true)` ALWAYS, unlike `declareRepoPolicy`'s optional `adopt` — a
 * baseline this widely shared is meant for a checkout adopting the estate's existing repository
 * and ruleset by name, never for creating one out from under a caller who forgot the flag (H1: a
 * name match is not ours until adopted).
 *
 * ⛔ NO IMPORT FROM `@homeflare/config`, either direction — see `renderRepoShape`'s own header
 *   in `packages/config/src/repo-shape/render.ts`. A caller spreads `renderRepoShape(shape)
 *   .policy` into these options itself; `checks` only needs to be `readonly string[]`.
 *
 * ⛔ APPLY ORDER: `allowAutoMerge` NEVER GOES LIVE BEFORE THE RULESET IT WAITS ON. When `checks`
 *   is non-empty, the ruleset is declared and applied FIRST, and the repository's `allowAutoMerge`
 *   is threaded through `gateAutoMergeOnRuleset` (repo-auto-merge-gate.ts) so Alchemy's own
 *   Output-in-props ordering — not declaration order — makes the engine wait for it. See that
 *   file's header for the full mechanism, the K5 hazard it closes, and why the reverse direction
 *   (checks removed) needs no matching edge.
 * ⚠️ A REPOSITORY THAT DOES NOT YET EXIST: `adopt(true)` above does NOT refuse to create — with
 *   nothing live to adopt, Alchemy creates from scratch regardless (`AdoptPolicy`'s own contract:
 *   `undefined` observed state means create, adopt policy or not). The paragraph above says this
 *   baseline is "never for creating one out from under a caller who forgot the flag", but nothing
 *   enforces that; it is the caller's discipline, not this function's. If it IS ever called for a
 *   repo+ruleset that do not exist yet with `checks` non-empty from day one, the forced
 *   ruleset-first order above now makes the ruleset's create fail — GitHub's own ruleset API
 *   404s on a repository that does not exist — instead of racing. That failure is explicit and
 *   tested (declare-repo-baseline-apply-order.test.ts's "created together" case), not a silent
 *   fail-open, but it is still a real usability regression for that one scenario: create the bare
 *   repository first (a prior deploy, or a separate `GitHub.Repository` call).
 */
import { adopt } from 'alchemy/AdoptPolicy';
import * as GitHub from 'alchemy/GitHub';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import {
  type RepoBaselineInput,
  repoBaselineRuleset,
  repoBaselineSettings,
} from './repo-baseline-data.ts';
import { gateAutoMergeOnRuleset } from './repo-auto-merge-gate.ts';
import { RepositoryRuleset } from './repository-ruleset.ts';

export interface DeclareRepoBaselineOptions extends RepoBaselineInput {}

export const declareRepoBaseline = (id: string, options: DeclareRepoBaselineOptions) =>
  Effect.gen(function* () {
    const owned = <A, R>(resource: Effect.Effect<A, never, R>) =>
      resource.pipe(RemovalPolicy.retain(), adopt(true));
    const settings = repoBaselineSettings(options);

    // Auto-merge is turning on (or staying on): declare and apply the ruleset FIRST, so its
    // rulesetId is available to gate the repository's allowAutoMerge — see the file header.
    if (settings.allowAutoMerge) {
      const ruleset = yield* owned(
        RepositoryRuleset(`${id}-ruleset`, repoBaselineRuleset(options)),
      );
      const repository = yield* owned(
        GitHub.Repository(id, gateAutoMergeOnRuleset(settings, ruleset)),
      );
      return { repository, ruleset };
    }

    const repository = yield* owned(GitHub.Repository(id, settings));
    const ruleset = yield* owned(RepositoryRuleset(`${id}-ruleset`, repoBaselineRuleset(options)));
    return { repository, ruleset };
  });
