/**
 * `declareRepoPolicy` — the policy from repo-policy-form.ts, as resources.
 *
 *     const policy = yield* declareRepoPolicy('api', {
 *       owner: 'my-org',
 *       repository: 'api',
 *       checks: ['ci', 'secret scan'],
 *     });
 *
 * Provide `GitHub.providers()`; this subpath adds no provider of its own.
 *
 * ⛔ THE RULESET CANNOT BE ADOPTED, AND A FIRST DEPLOY ONTO A REPO THAT ALREADY HAS ONE
 *   MAKES A SECOND. Read out of alchemy@2.0.0-beta.79's own source on 2026-09-22
 *   (`node_modules/alchemy/lib/github/Ruleset.js`): `read` returns `undefined` whenever
 *   there is no prior output, and `reconcile` looks the live ruleset up only BY THE ID IN
 *   THAT OUTPUT — with none, it calls `createRepoRuleset` unconditionally. GitHub permits
 *   several rulesets with the same name on one repository, so nothing errors; the repo
 *   quietly ends up with two, both enforcing.
 *   ★ SO, BEFORE THE FIRST DEPLOY: `gh api repos/<owner>/<repo>/rulesets` and delete a
 *     hand-made ruleset of the same name, or give this one a `rulesetName` of its own.
 *     Afterwards the state carries the id and every later deploy converges that one.
 *   ⚠️ `GitHub.Repository` does NOT share the problem — its `reconcile` probes by name
 *     and converges onto whatever is live — so only half of this helper is adopt-safe,
 *     and the halves fail differently. See docs/repo-policy.md.
 *
 * ⛔ BOTH RESOURCES RETAIN. `retain` is already the vendor default for each of them; it
 *   is piped anyway so that a vendor change cannot quietly turn "drop this call from the
 *   stack" into "delete the repository" or "unprotect the default branch".
 */
import { adopt } from 'alchemy/AdoptPolicy';
import * as GitHub from 'alchemy/GitHub';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import { type RepoPolicyOptions, repoPolicy } from './repo-policy-form.ts';

export interface DeclareRepoPolicyOptions extends RepoPolicyOptions {
  /**
   * `true`/`false` pipe `adopt(…)` onto both resources; omitted, the deploy's own policy
   * decides. ⚠️ It changes nothing about the ruleset hazard above: adoption routes on
   * what a provider's `read` reports, and this one reports nothing without prior state.
   */
  readonly adopt?: boolean;
}

/**
 * Declares the repository and its ruleset under `<id>` and `<id>-ruleset`. Fails, before
 * declaring either, on any policy the form refuses.
 */
export const declareRepoPolicy = (id: string, options: DeclareRepoPolicyOptions) =>
  Effect.gen(function* () {
    const policy = yield* Effect.try({
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      try: () => repoPolicy(options),
    });
    // ⚠️ `never` in the error channel, not a generic `E`: `AdoptPolicy.adopt` is typed
    //   `Effect<A, never, R> => Effect<A, never, R>`, so a wider error type fails to
    //   compile here rather than at the call site. Alchemy's resources declare `never`.
    const owned = <A, R>(resource: Effect.Effect<A, never, R>) => {
      const kept = resource.pipe(RemovalPolicy.retain());
      return options.adopt === undefined ? kept : kept.pipe(adopt(options.adopt));
    };
    const repository = yield* owned(GitHub.Repository(id, policy.repository));
    const ruleset = yield* owned(GitHub.Ruleset(`${id}-ruleset`, policy.ruleset));
    return { policy, repository, ruleset };
  });
