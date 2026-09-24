/**
 * `GitHub.RepositoryRuleset` — a bridge resource for the one thing upstream `GitHub.Ruleset`
 * cannot do: find a ruleset that already exists before creating a second one with the same
 * name.
 *
 * ⛔ THE HAZARD THIS EXISTS TO CLOSE. Read out of `alchemy@2.0.0-beta.79`'s own source
 *   (`node_modules/alchemy/src/GitHub/Ruleset.ts`, `reconcile`): `let observed = output ===
 *   undefined ? undefined : yield* getRuleset(news, output.rulesetId)`. With no prior state,
 *   `observed` stays `undefined` and `createRepoRuleset` runs UNCONDITIONALLY — there is no
 *   probe by name. GitHub permits several rulesets with one name on a repository, so nothing
 *   errors; the repo quietly ends up with two, both enforcing. `declareRepoPolicy` in this same
 *   package (repo-policy.ts) documents the same hazard and tells a caller to check `gh api
 *   repos/<owner>/<repo>/rulesets` by hand before every first deploy. This resource makes that
 *   check the engine's own job: `read`/`reconcile` list-and-filter by name+target before ever
 *   creating (see repository-ruleset-probe.ts).
 *
 * ★ WHY A NEW TYPE STRING, NOT A PATCHED `GitHub.Ruleset`. Upstream's `Ruleset` cannot be
 *   edited from here — it ships inside the `alchemy` package. `GitHub.RepositoryRuleset` is a
 *   distinct `Provider` (its own `Context.Service` keyed by this type string — see
 *   `alchemy/src/Provider.ts#Provider`), so it is declared and merged into a stack's provider
 *   layer independently of `GitHub.providers()` — the same way `postgres/database.ts` merges
 *   `PostgresDatabaseProvider()` beside it. Nothing about upstream's `GitHub.Providers`
 *   collection needs touching for the two to coexist in one stack. Props are a strict superset
 *   of upstream's `RulesetProps` (H14: the type string sits inside upstream's own `GitHub`
 *   namespace, recorded as house difference H15 below for the client choice).
 *
 * ⛔ H15: CLIENT IS OCTOKIT, NOT DISTILLED — A NAMED DIVERGENCE FROM S23. The house's default is
 *   `@distilled.cloud/*` when a vendor SDK exists there, and `@distilled.cloud/github@1.0.0-rc.12`
 *   does ship `createRepoRuleset`/`updateRepoRuleset`. But it has NO field for
 *   `require_extra_approval_for_unattributed_changes` (measured 2026-09-22: grep of its
 *   generated types), and its request bodies are plain `effect/Schema` `S.Struct`s, which strip
 *   properties a schema does not declare on encode — REASONED, not measured against distilled
 *   itself; repository-ruleset-wire.test.ts measures the Octokit side of the same question
 *   instead, because Octokit is the client this file actually uses. That flag is the entire
 *   reason this resource exists for the 0-approval, solo-maintainer shape (see
 *   repo-policy-guards.ts's `resolveApprovals` for the same story on the upstream-only path):
 *   GitHub defaults it to `true` when absent, which blocks the very pull requests a `0` was
 *   meant to allow. `octokitFor`/`GitHubCredentials` are upstream's own EXPORTED building
 *   blocks (S23's second clause: reuse Alchemy's own client construction), so the client itself
 *   is not hand-rolled — only the choice of Octokit over distilled is a recorded divergence.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { GitHubCredentials } from 'alchemy/GitHub';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import {
  allowedMergeMethodsRefusal,
  approvalCountRefusal,
} from './repository-ruleset-constraints.ts';
import { RulesetConstraintRefused } from './repository-ruleset-errors.ts';
import { makeRulesetOctokit } from './repository-ruleset-octokit.ts';
import { type RulesetRecord, probeByName } from './repository-ruleset-probe.ts';
import type { RepositoryRulesetProps } from './repository-ruleset-props.ts';
import { reconcileRuleset } from './repository-ruleset-reconcile.ts';

export type {
  RepositoryRulesetProps,
  RepositoryRulesetPullRequestRule,
  RepositoryRulesetReviewerRule,
  RepositoryRulesetRules,
  RepositoryRulesetStatusChecksRule,
} from './repository-ruleset-props.ts';

export interface RepositoryRulesetAttributes {
  readonly rulesetId: number;
  readonly nodeId: string | undefined;
  readonly name: string;
  readonly createdAt: string | undefined;
  readonly updatedAt: string | undefined;
}

export interface RepositoryRuleset extends Resource<
  'GitHub.RepositoryRuleset',
  RepositoryRulesetProps,
  RepositoryRulesetAttributes,
  never,
  GitHubCredentials
> {}

export const RepositoryRuleset = Resource<RepositoryRuleset>('GitHub.RepositoryRuleset', {
  defaultRemovalPolicy: 'retain',
});

export const attrsOf = (r: RulesetRecord): RepositoryRulesetAttributes => ({
  rulesetId: r.id,
  nodeId: r.node_id,
  name: r.name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Plan-time-only refusals — no live data needed, so these run before any read (schema-codegen's
 * rule: check the form before the "no previous state" branch, never after it). */
function constraintRefusal(props: RepositoryRulesetProps): RulesetConstraintRefused | undefined {
  // `=== false` narrows `pullRequest` out of the `| false` half added for exact-adopt
  // pass-through (see `RepositoryRulesetRules` above) — a declared absence has no fields to
  // constrain.
  const pr = props.rules?.pullRequest === false ? undefined : props.rules?.pullRequest;
  const approvals = pr?.requiredApprovingReviewCount;
  if (approvals !== undefined) {
    const reason = approvalCountRefusal(approvals);
    if (reason !== undefined) {
      return new RulesetConstraintRefused({
        field: 'rules.pullRequest.requiredApprovingReviewCount',
        reason,
      });
    }
  }
  const methods = pr?.allowedMergeMethods;
  if (methods !== undefined) {
    const reason = allowedMergeMethodsRefusal(methods);
    if (reason !== undefined) {
      return new RulesetConstraintRefused({
        field: 'rules.pullRequest.allowedMergeMethods',
        reason,
      });
    }
  }
  // ⚠️ NO SEPARATE PLAN-TIME CHECK FOR A BLANK `acknowledge{Bypass,Rule}Narrowing.reason` HERE.
  //   A blank reason is already indistinguishable from "not acknowledged at all" —
  //   `isBypassNarrowingAcknowledged`/`isRuleNarrowingAcknowledged`
  //   (repository-ruleset-narrowing-guards.ts) each require a non-empty, trimmed `reason` on
  //   their OWN prop, and the matching narrowing guard reads that, not presence alone. Adding a
  //   SECOND check here would refuse with `RulesetConstraintRefused` instead of the more
  //   specific `BypassActorNarrowed`/`RuleNarrowed` the caller actually needs to act on — and,
  //   unlike those two (exercised directly through `reconcileRuleset`, injected-octokit fakes
  //   included), this function is wired only through the real `RepositoryRuleset.Provider`
  //   (`makeRulesetOctokit` needs live `GitHubCredentials`), which this family's own test
  //   helpers do not exercise (see `repository-ruleset-test-helpers.ts`'s stub
  //   `constraintRefusal`) — a check that lives only here would ship untested.
  return undefined;
}

export const repositoryRulesetHandlers = RepositoryRuleset.Provider.of({
  // Account-wide, cross-repo enumeration duplicates upstream `GitHub.Ruleset`'s own `list` for
  // no benefit here — every RepositoryRuleset is declared once, by name, in a checkout's own
  // stack (S12 already defaults this; nuke should never touch a `retain` ruleset regardless).
  list: () => Effect.succeed([]),
  nuke: { skip: true },

  read: ({ output, olds }) =>
    Effect.gen(function* () {
      const octokit = makeRulesetOctokit(olds.baseUrl);
      if (output === undefined) {
        const match = yield* probeByName(octokit, {
          owner: olds.owner,
          repo: olds.repository,
          name: olds.name,
          target: olds.target ?? 'branch',
        });
        // Identical is not ours (H1): a name match with no prior state needs adopt(true).
        return match === undefined ? undefined : Unowned(attrsOf(match));
      }
      const byId = yield* octokit.get({
        owner: olds.owner,
        repo: olds.repository,
        rulesetId: output.rulesetId,
      });
      if (byId !== undefined) return attrsOf(byId);
      const byName = yield* probeByName(octokit, {
        owner: olds.owner,
        repo: olds.repository,
        name: olds.name,
        target: olds.target ?? 'branch',
      });
      return byName === undefined ? undefined : attrsOf(byName);
    }),

  // Plain function, not `Effect.fn(function* …)` — there is nothing here to `yield*`, and an
  // empty generator is its own lint hazard (oxlint's `require-yield`) for a reason: it reads as
  // an unfinished `Effect.gen` body.
  diff: ({ news, olds }) =>
    Effect.succeed(
      isResolved(news) &&
        olds !== undefined &&
        (news.owner !== olds.owner || news.repository !== olds.repository)
        ? ({ action: 'replace' } as const)
        : undefined,
    ),

  reconcile: ({ news, output }) =>
    reconcileRuleset({
      octokit: makeRulesetOctokit(news.baseUrl),
      news,
      output,
      constraintRefusal,
      attrsOf,
    }),

  delete: ({ olds, output }) =>
    Effect.gen(function* () {
      if (output?.rulesetId === undefined) return;
      const octokit = makeRulesetOctokit(olds.baseUrl);
      yield* octokit.delete({
        owner: olds.owner,
        repo: olds.repository,
        rulesetId: output.rulesetId,
      });
    }),
});

export const RepositoryRulesetProvider = () =>
  Provider.succeed(RepositoryRuleset, repositoryRulesetHandlers);
