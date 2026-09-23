/**
 * Shared plumbing for the write-recording fake tests, split out of
 * repository-ruleset-write.test.ts and repository-ruleset-write-refusals.test.ts purely to keep
 * both under the 250-line file cap — nothing here is a fixture of house-standard VALUES (that
 * is repository-ruleset-fixtures.ts); this is just "run an Effect", "expect it to fail", and one
 * baseline-shaped `RepositoryRulesetProps` for `widgets`.
 */
import * as Effect from 'effect/Effect';
import type { RecordingFake } from './repository-ruleset-fake-octokit.ts';
import {
  type RepositoryRulesetProps,
  type RepositoryRulesetPullRequestRule,
  attrsOf,
} from './repository-ruleset.ts';
import type {
  RepositoryRulesetError,
  RulesetConstraintRefused,
} from './repository-ruleset-errors.ts';
import { reconcileRuleset } from './repository-ruleset-reconcile.ts';
import type { RulesetOctokit } from './repository-ruleset-probe.ts';

export const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
export const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> =>
  Effect.runPromise(Effect.flip(eff));

/** Every case across both files expects a TAGGED refusal, never the plain transport `Error` a
 * real fetch failure would carry — narrowing here keeps every test's assertion a one-liner. */
export const tagOf = (error: RepositoryRulesetError | Error): string =>
  '_tag' in error ? error._tag : `(untagged) ${error.message}`;

export const constraintRefusal = () => undefined as RulesetConstraintRefused | undefined;

export const BASE_PULL_REQUEST: RepositoryRulesetPullRequestRule = {
  requiredApprovingReviewCount: 0,
  allowedMergeMethods: ['squash'],
  extraApprovalForUnattributedChanges: false,
};

export const props = (over: Partial<RepositoryRulesetProps> = {}): RepositoryRulesetProps => ({
  owner: 'taslabs-net',
  repository: 'widgets',
  name: 'main',
  target: 'branch',
  enforcement: 'active',
  conditions: { include: ['~DEFAULT_BRANCH'], exclude: [] },
  rules: {
    deletion: true,
    nonFastForward: true,
    pullRequest: BASE_PULL_REQUEST,
    requiredStatusChecks: { checks: [{ context: 'ci' }] },
  },
  ...over,
});

/** Reconciles `p` against a `RecordingFake`, with `output` (when given) shaped as a real
 * `RepositoryRulesetAttributes` — every field but `rulesetId` defaulted, since no test here
 * reads `nodeId`/timestamps. */
export const reconcileAgainst = (
  fake: RecordingFake,
  p: RepositoryRulesetProps,
  output?: { rulesetId: number },
) =>
  reconcileRuleset({
    octokit: fake.octokit,
    news: p,
    output:
      output === undefined
        ? undefined
        : {
            ...output,
            nodeId: undefined,
            name: p.name,
            createdAt: undefined,
            updatedAt: undefined,
          },
    constraintRefusal,
    attrsOf,
  });

/** For the hand-built fakes in the refusals file, which construct a `RulesetOctokit` directly
 * rather than going through `RecordingFake`. */
export const reconcileWithOctokit = (
  octokit: RulesetOctokit,
  p: RepositoryRulesetProps,
  output?: { rulesetId: number },
) =>
  reconcileRuleset({
    octokit,
    news: p,
    output:
      output === undefined
        ? undefined
        : {
            ...output,
            nodeId: undefined,
            name: p.name,
            createdAt: undefined,
            updatedAt: undefined,
          },
    constraintRefusal,
    attrsOf,
  });
