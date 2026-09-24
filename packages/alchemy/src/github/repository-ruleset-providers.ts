/**
 * `repoPolicyProviders` — the documented stack wiring for `RepositoryRuleset` (directly, or
 * through `declareRepoPolicy` / `declareRepoBaseline`): `GitHub.providers()` and
 * `RepositoryRulesetProvider()`, composed so the whole thing typechecks and needs nothing
 * further from the stack.
 *
 *     providers: repoPolicyProviders()
 *
 * ⛔ WHY THIS EXISTS — MEASURED 2026-09-24 (homeflare-builds bump PR 6, tsc). Writing the two
 *   providers side by side, `Layer.mergeAll(GitHub.providers(), RepositoryRulesetProvider())`,
 *   type-errors: `RepositoryRulesetProvider()`'s handlers call `octokitFor`, which needs
 *   `GitHubCredentials` — a requirement of the PROVIDER's layer, correctly inferred by
 *   `Provider.succeed` from `repositoryRulesetHandlers` in repository-ruleset.ts. Merging two
 *   layers does not thread one's output into the other's requirement; `RepositoryRulesetProvider()`
 *   still needs `GitHubCredentials` fed in. `GitHub.providers()` is the only thing here that
 *   resolves credentials (env, stored PAT, `gh` CLI, or OAuth — see `alchemy/src/GitHub/
 *   Providers.ts`), and — because it chains `Layer.provideMerge(Credentials.fromAuthProvider(…))`
 *   internally rather than `Layer.provide` — its own OUTPUT includes `GitHubCredentials`
 *   alongside `GitHub.Providers`. `Layer.provideMerge(github)` on `RepositoryRulesetProvider()`
 *   both supplies that requirement AND keeps `github`'s own output merged in for any
 *   `GitHub.Repository`/`GitHub.Ruleset` the caller also declares. `github` is built once and
 *   referenced twice below — Effect's layer memoization (by reference) builds it once, not
 *   twice, not twice against the auth provider either.
 *
 * ★ THIS IS ONLY HALF OF 2026-09-24's FIX. The other half — `RepositoryRuleset`'s own `Resource<>`
 *   declaration no longer naming `GitHubCredentials` in its 5th (`Providers`) slot — lives in
 *   repository-ruleset.ts's file header; that half is what let a stack BODY calling
 *   `declareRepoPolicy`/`declareRepoBaseline` typecheck at all. Composing the providers
 *   correctly, as this function does, does not by itself fix a body that still requires
 *   `GitHubCredentials` directly.
 *
 * ⚠️ DON'T ALSO MERGE A SEPARATE `GitHub.providers()` CALL IN. `github` here is one Layer
 *   object referenced twice, which Effect's layer memoization (by reference, ADVERSARIAL
 *   REVIEW 2026-09-24: confirmed against `effect@4.0.0-rc.115`'s own `MemoMap`) builds once. A
 *   stack that ALSO writes its own `GitHub.providers()` alongside this function's result is a
 *   second, distinct Layer object — a genuine second credential resolution, not shared with
 *   this one. Get every GitHub resource's providers from this one call.
 */
import * as GitHub from 'alchemy/GitHub';
import * as Layer from 'effect/Layer';
import { RepositoryRulesetProvider } from './repository-ruleset.ts';

export const repoPolicyProviders = (options?: GitHub.ProvidersOptions) => {
  const github = GitHub.providers(options);
  return Layer.mergeAll(github, RepositoryRulesetProvider().pipe(Layer.provideMerge(github)));
};
