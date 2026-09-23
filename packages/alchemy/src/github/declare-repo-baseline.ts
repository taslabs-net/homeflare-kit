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
 * Provide `GitHub.providers()` AND `RepositoryRulesetProvider()` — this subpath ships no
 * provider of its own, the same as `declareRepoPolicy`. Both resources are `retain` and
 * `adopt(true)` ALWAYS, unlike `declareRepoPolicy`'s optional `adopt` — a baseline this widely
 * shared is meant for a checkout adopting the estate's existing repository and ruleset by name,
 * never for creating one out from under a caller who forgot the flag (H1: a name match is not
 * ours until adopted).
 *
 * ⛔ NO IMPORT FROM `@homeflare/config`, either direction — see `renderRepoShape`'s own header
 *   in `packages/config/src/repo-shape/render.ts`. A caller spreads `renderRepoShape(shape)
 *   .policy` into these options itself; `checks` only needs to be `readonly string[]`.
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
import { RepositoryRuleset } from './repository-ruleset.ts';

export interface DeclareRepoBaselineOptions extends RepoBaselineInput {}

export const declareRepoBaseline = (id: string, options: DeclareRepoBaselineOptions) =>
  Effect.gen(function* () {
    const owned = <A, R>(resource: Effect.Effect<A, never, R>) =>
      resource.pipe(RemovalPolicy.retain(), adopt(true));
    const repository = yield* owned(GitHub.Repository(id, repoBaselineSettings(options)));
    const ruleset = yield* owned(RepositoryRuleset(`${id}-ruleset`, repoBaselineRuleset(options)));
    return { repository, ruleset };
  });
