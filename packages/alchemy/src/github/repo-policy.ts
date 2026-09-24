/**
 * `declareRepoPolicy` — the policy from repo-policy-form.ts, as resources.
 *
 *     const policy = yield* declareRepoPolicy('api', {
 *       owner: 'my-org',
 *       repository: 'api',
 *       checks: ['ci', 'secret scan'],
 *     });
 *
 * Provide `repoPolicyProviders()` (repository-ruleset-providers.ts) — the composed
 * `GitHub.providers()` + `RepositoryRulesetProvider()` layer; this subpath adds no GitHub
 * provider of its own beyond the ruleset bridge.
 *
 * ★ REWIRED 2026-09-23 onto `GitHub.RepositoryRuleset`, not upstream `GitHub.Ruleset` — the
 *   ADOPT-SAFE bridge documented in repository-ruleset.ts. Only `builds` calls this, and its
 *   ruleset has NEVER been created (LIVE SURVEY 2026-09-23: 0 rulesets live on `builds`), so
 *   the swap changes no live resource's identity; a cold first deploy is the only deploy this
 *   call has ever had. `homeflare/docs/repo-policy-ruleset-hazards.md`'s "before the first
 *   deploy, check by hand" workaround is now enforced by the resource itself (the name-probe in
 *   repository-ruleset-probe.ts) rather than left to the operator — see that doc for the
 *   history, kept rather than deleted so the hazard `builds` almost hit stays legible.
 * ⚠️ `GitHub.Repository` keeps its OWN upstream behavior unchanged — it already probed by name
 *   and converged, so only the ruleset half of this helper needed the swap.
 *
 * ⛔ BOTH RESOURCES RETAIN. `retain` is already the vendor default for each of them; it
 *   is piped anyway so that a vendor change cannot quietly turn "drop this call from the
 *   stack" into "delete the repository" or "unprotect the default branch".
 *
 * ⛔ APPLY ORDER: `allowAutoMerge` NEVER GOES LIVE BEFORE THE RULESET IT WAITS ON — see
 *   repo-auto-merge-gate.ts's header for the mechanism (Alchemy orders by Output references in
 *   props, not declaration order), the K5 hazard it closes, and why checks/approvals being
 *   REMOVED needs no matching reverse edge. `assertAutoMergeWaits` (repo-policy-guards.ts)
 *   already guarantees `policy.repository.allowAutoMerge` is only ever `true` when the ruleset
 *   carries something outstanding (checks, approvals, or both), so that one flag is the gate.
 * ⚠️ A REPOSITORY THAT DOES NOT YET EXIST: gating on the ruleset only matters once there are open
 *   pull requests to prematurely merge, and `GitHub.Repository`'s own `reconcile` sets
 *   `allowAutoMerge` atomically in the SAME create call that makes the repo — no window where a
 *   PR could exploit it. This helper's documented use (`builds`, above) is always a repo that
 *   already converged before its ruleset's first deploy; a caller declaring both fresh in one
 *   deploy, with checks/approvals from day one, must create the bare repository first (a prior
 *   deploy, or a separate `GitHub.Repository` call) — GitHub's ruleset API 404s on a repo that
 *   does not exist yet, and this gate now makes the ruleset apply before the repository.
 */
import { adopt } from 'alchemy/AdoptPolicy';
import * as GitHub from 'alchemy/GitHub';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import { gateAutoMergeOnRuleset } from './repo-auto-merge-gate.ts';
import { type RepoPolicyOptions, repoPolicy } from './repo-policy-form.ts';
import { RepositoryRuleset } from './repository-ruleset.ts';

export interface DeclareRepoPolicyOptions extends RepoPolicyOptions {
  /**
   * `true`/`false` pipe `adopt(…)` onto both resources; omitted, the deploy's own policy
   * decides.
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
    // `policy.ruleset` is a plain `RulesetProps` — every field `RepositoryRulesetProps` adds
    // over it is optional, so it needs no translation to satisfy the bridge's props.

    // Auto-merge is turning on (or staying on): declare and apply the ruleset FIRST, so its
    // rulesetId is available to gate the repository's allowAutoMerge — see the file header.
    if (policy.repository.allowAutoMerge) {
      const ruleset = yield* owned(RepositoryRuleset(`${id}-ruleset`, policy.ruleset));
      const repository = yield* owned(
        GitHub.Repository(id, gateAutoMergeOnRuleset(policy.repository, ruleset)),
      );
      return { policy, repository, ruleset };
    }

    const repository = yield* owned(GitHub.Repository(id, policy.repository));
    const ruleset = yield* owned(RepositoryRuleset(`${id}-ruleset`, policy.ruleset));
    return { policy, repository, ruleset };
  });
