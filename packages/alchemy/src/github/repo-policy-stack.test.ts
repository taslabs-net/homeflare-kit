/**
 * TYPE-LEVEL test — a real `Alchemy.Stack(...)` whose body calls `declareRepoPolicy` AND
 * `declareRepoBaseline`, wired with the documented `repoPolicyProviders()`. This is the test
 * that would have caught 2026-09-24's bug (homeflare-builds bump PR 6, tsc TS2345):
 * `RepositoryRuleset`'s `Resource<>` declaration put `GitHubCredentials` — not
 * `Provider<RepositoryRuleset>` — in its 5th type parameter, so a stack BODY that only ever
 * calls `declareRepoPolicy`/`declareRepoBaseline` failed `tsc`, and nothing in this repo's own
 * `bun run check` exercised that path before now: every existing test in this family drives the
 * resource's CRUD handlers directly (repository-ruleset-*.test.ts) or the pure form functions
 * (repo-policy-form.test.ts), never a real `Alchemy.Stack(...)` body.
 *
 * ⚠️ BUILT, NEVER RUN. `Alchemy.Stack(...)` returns an unexecuted `Effect` — every combinator
 *   between here and a runtime (`.pipe`, `Effect.gen`, `Effect.flatMap`, `Object.assign`) is
 *   itself lazy (MEASURED by reading `alchemy/src/Stack.ts`'s own `Stack`/`make`: no
 *   `Effect.runSync`/`runPromise` anywhere in the construction path). Building the value is
 *   enough to make `tsc` check the body's inferred requirement type against `Stack`'s own
 *   `Req extends StackServices | ProviderServices` constraint — see repository-ruleset.ts's
 *   file header for what that constraint is and why `GitHubCredentials` used to fail it. This
 *   test never calls `Effect.runPromise`/`runSync`: no network, no `GitHubCredentials`
 *   resolved, no state written.
 *
 * ⚠️ `.pipe(Effect.orDie)` ON `declareRepoPolicy` IS UNRELATED TO WHAT THIS TEST CHECKS.
 *   `declareRepoPolicy` refuses a bad policy through `Effect.try`'s `catch`, so its error
 *   channel is `Error`, not `never` — a separate, pre-existing type surface (present since its
 *   original PR #98) that `Alchemy.Stack`'s own `eff: Effect.Effect<A, ConfigError, Req>` does
 *   not accept regardless of the `Req`/`Providers` bug this test targets. Dying on it here keeps
 *   that surface out of the way without papering over it — a real caller still has to decide how
 *   to handle a refused policy, which this test deliberately does not answer.
 */
import { expect, test } from 'bun:test';
import * as Alchemy from 'alchemy';
import * as Effect from 'effect/Effect';
import { declareRepoBaseline } from './declare-repo-baseline.ts';
import { declareRepoPolicy } from './repo-policy.ts';
import { repoPolicyProviders } from './repository-ruleset-providers.ts';

test('declareRepoPolicy and declareRepoBaseline typecheck as one Alchemy.Stack body', () => {
  const stack = Alchemy.Stack(
    'repo-policy-typecheck',
    { providers: repoPolicyProviders(), state: Alchemy.inMemoryState() },
    Effect.gen(function* () {
      const policy = yield* declareRepoPolicy('api', {
        owner: 'taslabs-net',
        repository: 'api',
        checks: ['ci', 'secret scan'],
      }).pipe(Effect.orDie);
      const baseline = yield* declareRepoBaseline('widgets', {
        owner: 'taslabs-net',
        repository: 'widgets',
        checks: ['ci'],
        visibility: 'private',
      });
      return { policy, baseline };
    }),
  );
  // Not run — see file header. This only proves construction didn't throw synchronously; the
  // real assertion is `tsc`'s, over the whole expression above.
  expect(stack).toBeDefined();
});
