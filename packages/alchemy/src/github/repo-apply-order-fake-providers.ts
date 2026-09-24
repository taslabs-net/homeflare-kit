/**
 * Fully in-memory `Provider.succeed(...)` fakes for `GitHub.Repository` and `RepositoryRuleset`
 * — no octokit, no `GitHubCredentials`, no network. Unlike `repository-ruleset-fake-octokit.ts`
 * (a fake HTTP client fed into the REAL provider's `reconcile`), these fakes replace the provider
 * entirely, because what `declare-repo-baseline-apply-order.test.ts` and
 * `repo-policy-apply-order.test.ts` measure is the ENGINE's own scheduling — which resource's
 * `reconcile` runs first, and whether one's failure reaches the other — not GitHub's wire
 * protocol. `Provider.succeed`'s runtime lookup (`tryFindProviderRegistrationByType`,
 * `node_modules/alchemy/src/Provider.ts`) checks the INDIVIDUAL `Provider<R>` tag before falling
 * back to a `GitHub.Providers` collection, so registering these two standalone providers is
 * enough regardless of `GitHub.Repository`'s own declared `Providers` slot — the same shortcut
 * `RepositoryRulesetProvider()` already relies on.
 *
 * ⚠️ NO LIVE NETWORK, EVER. Nothing here imports `octokit`/`GitHubCredentials`, so a test built
 *   on this file cannot make a real GitHub call even by accident — required by this PR's own
 *   "no live GitHub writes" rule.
 *
 * ⚠️ THE FAKE RULESET REFUSES A REPO THAT DOESN'T EXIST YET, ON PURPOSE — mirroring GitHub's own
 *   `POST /repos/{owner}/{repo}/rulesets`, which 404s on a repo that hasn't been created. A first
 *   ADVERSARIAL REVIEW pass (2026-09-24) on this PR found that the ordering fix forces the
 *   ruleset to apply before the repository whenever auto-merge turns on — safe for an UPDATE
 *   (the repo already exists), but a real hazard for a repo+ruleset created together for the
 *   FIRST time with checks set from day one, and the original version of this fake modeled no
 *   such constraint, so its own tests could not have caught that regression. It now can — see
 *   `declare-repo-baseline-apply-order.test.ts`'s "a repo and ruleset created together" test.
 */
import * as GitHub from 'alchemy/GitHub';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { RepositoryRuleset, type RepositoryRulesetProps } from './repository-ruleset.ts';

/** One resource type's name, in the order its fake `reconcile` was actually invoked. */
export type CallLog = ('repository' | 'ruleset')[];

export interface World {
  readonly calls: CallLog;
  /** `owner/name` of every repository the fake repository provider has reconciled at least
   * once — what the fake ruleset provider checks before allowing a create. */
  readonly liveRepositories: Set<string>;
  /** Set before `deploy` to make the ruleset's `reconcile` fail instead of succeeding, even
   * against a repository already in `liveRepositories`. */
  rulesetShouldFail: boolean;
  /** `news.allowAutoMerge` as the repository's fake `reconcile` last observed it — `undefined`
   * until (unless) the repository's `reconcile` actually runs. */
  repositoryAllowAutoMerge: boolean | undefined;
}

export const makeWorld = (): World => ({
  calls: [],
  liveRepositories: new Set(),
  rulesetShouldFail: false,
  repositoryAllowAutoMerge: undefined,
});

let sequence = 0;
const nextId = () => {
  sequence += 1;
  return sequence;
};

const fakeRepositoryProvider = (world: World) =>
  Provider.succeed(GitHub.Repository, {
    list: () => Effect.succeed([]),
    reconcile: ({ news }: { readonly news: GitHub.RepositoryProps }) =>
      Effect.sync(() => {
        world.calls.push('repository');
        world.repositoryAllowAutoMerge = news.allowAutoMerge;
        const id = nextId();
        const fullName = `${news.owner}/${news.name}`;
        world.liveRepositories.add(fullName);
        return {
          repoId: id,
          nodeId: `repo-node-${id}`,
          fullName,
          htmlUrl: `https://github.com/${fullName}`,
          gitUrl: `git://github.com/${fullName}.git`,
          sshUrl: `git@github.com:${fullName}.git`,
          cloneUrl: `https://github.com/${fullName}.git`,
          defaultBranch: 'main',
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        };
      }),
    delete: () => Effect.void,
  });

const fakeRulesetProvider = (world: World) =>
  Provider.succeed(RepositoryRuleset, {
    list: () => Effect.succeed([]),
    reconcile: ({ news }: { readonly news: RepositoryRulesetProps }) =>
      Effect.gen(function* () {
        world.calls.push('ruleset');
        if (world.rulesetShouldFail) {
          return yield* Effect.fail(new Error('fake ruleset apply failure'));
        }
        const fullName = `${news.owner}/${news.repository}`;
        if (!world.liveRepositories.has(fullName)) {
          // The real `POST /repos/{owner}/{repo}/rulesets` 404s here — the target repository
          // does not exist yet. See this file's header.
          return yield* Effect.fail(
            new Error(`fake GitHub 404: repository '${fullName}' does not exist yet`),
          );
        }
        const id = nextId();
        return {
          rulesetId: id,
          nodeId: `ruleset-node-${id}`,
          name: news.name,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        };
      }),
    delete: () => Effect.void,
  });

/** Both fakes, merged — everything `declareRepoBaseline`/`declareRepoPolicy` need. */
export const fakeGithubProviders = (world: World) =>
  Layer.mergeAll(fakeRepositoryProvider(world), fakeRulesetProvider(world));
