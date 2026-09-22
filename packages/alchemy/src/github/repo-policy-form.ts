/**
 * `repoPolicy` — one repository's house merge policy, as plain Alchemy props.
 *
 * ★ PURE ON PURPOSE, AND TYPE-ONLY IMPORTS. The exact shape a stack will deploy can be
 *   asserted in a unit test with no credentials, no network and no Effect runtime.
 *   `repo-policy.ts` is the thin half that turns these props into resources, and
 *   `repo-policy-guards.ts` holds everything this refuses and why.
 *
 * ⛔ AUTO-MERGE WITH NOTHING TO WAIT FOR MERGES IMMEDIATELY. `gh pr merge --auto` is a
 *   queue only while something is outstanding. Three different inputs produce "nothing
 *   outstanding" — no `checks` and no `requiredApprovals`, an `enforcement` that is not
 *   `active`, and an empty `include` — and all three are refused. See the guards module.
 *
 * ⛔ EVERY CONTEXT IN `checks` MUST ALWAYS REPORT. A required context that never reports
 *   is not "passed", it is "pending", and the pull request waits on it forever —
 *   auto-merge included. Point this at an aggregate job that runs `if: always()` and
 *   fails when any upstream job did, never at a job behind a `paths:` filter, a matrix
 *   leg, or anything a skipped workflow can silence.
 */
import type { RepositoryProps, RulesetProps } from 'alchemy/GitHub';
import {
  assertAutoMergeWaits,
  normalizeChecks,
  normalizeInclude,
  requireName,
  resolveApprovals,
} from './repo-policy-guards.ts';

/** Alchemy's own bypass-actor shape, re-exported so a caller imports one module, not two. */
export type RepoPolicyBypassActor = NonNullable<RulesetProps['bypassActors']>[number];

/**
 * Repository fields the policy does NOT own — description, topics, visibility, …
 * ⛔ Merged UNDERNEATH the policy, so a caller can describe their repo but cannot quietly
 *   re-enable merge commits through this door. The omitted keys are the policy itself.
 * ⛔ `baseUrl` IS OMITTED TOO, and is a top-level option instead. Setting it on only one
 *   of the two resources would point the repository at a GitHub Enterprise host and its
 *   ruleset at github.com — two halves of one policy on two different instances.
 */
export type RepoPolicyRepositorySettings = Omit<
  RepositoryProps,
  | 'allowAutoMerge'
  | 'allowMergeCommit'
  | 'allowRebaseMerge'
  | 'allowSquashMerge'
  | 'baseUrl'
  | 'deleteBranchOnMerge'
  | 'name'
  | 'owner'
>;

export interface RepoPolicyOptions {
  /** Repository owner — a user or organization login. */
  readonly owner: string;
  /** Repository name. */
  readonly repository: string;
  /**
   * Status-check contexts a pull request must pass, named exactly as the job reports
   * them. Trimmed, de-duplicated and sorted, so re-ordering the list is not a diff.
   */
  readonly checks: readonly string[];
  /** @default true — with nothing required it is refused, not quietly downgraded. */
  readonly autoMerge?: boolean;
  /** @default 'main' */
  readonly rulesetName?: string;
  /** Ref patterns the ruleset covers. @default ['~DEFAULT_BRANCH'] */
  readonly include?: readonly string[];
  /** Ref patterns exempted from it. @default [] */
  readonly exclude?: readonly string[];
  /** Who may bypass the ruleset. @default [] — nobody, administrators included. */
  readonly bypassActors?: readonly RepoPolicyBypassActor[];
  /**
   * Approving reviews a pull request needs. Omit for none — `0` is refused rather than
   * read as "no reviews"; `resolveApprovals` in the guards module says why.
   */
  readonly requiredApprovals?: number;
  /** @default 'active' — anything else is refused alongside `autoMerge`. */
  readonly enforcement?: 'active' | 'disabled' | 'evaluate';
  /** GitHub Enterprise host, applied to BOTH resources or to neither. */
  readonly baseUrl?: string;
  /** Everything about the repository that is not merge policy. */
  readonly settings?: RepoPolicyRepositorySettings;
}

export interface RepoPolicy {
  readonly repository: RepositoryProps;
  readonly ruleset: RulesetProps;
}

const DEFAULT_RULESET_NAME = 'main';
/**
 * ★ `~DEFAULT_BRANCH`, NOT `refs/heads/main`. GitHub resolves it per repository, so one
 *   policy covers a repo whose default branch is `master` or `trunk`, and renaming the
 *   default branch later does not silently leave the ruleset pointing at nothing.
 */
const DEFAULT_INCLUDE: readonly string[] = ['~DEFAULT_BRANCH'];

/**
 * The house policy for one repository: squash-only merges, auto-merge on, head branches
 * deleted, and a ruleset over the default branch that blocks deletion and force pushes
 * and requires `checks`.
 *
 * ★ `strictRequiredStatusChecksPolicy` IS ALWAYS FALSE, AND NOT A PARAMETER. "Require
 *   branches to be up to date" means every merge to the default branch invalidates every
 *   other open pull request, which with auto-merge on is a re-run storm that converges
 *   only when the queue empties. The checks still have to pass; they just do not have to
 *   have passed against the very tip.
 */
export function repoPolicy(options: RepoPolicyOptions): RepoPolicy {
  const owner = requireName('owner', options.owner);
  const repository = requireName('repository', options.repository);
  const checks = normalizeChecks(options.checks);
  const include = normalizeInclude(options.include, DEFAULT_INCLUDE);
  const autoMerge = options.autoMerge ?? true;
  const enforcement = options.enforcement ?? 'active';
  const approvals = resolveApprovals(options.requiredApprovals);
  assertAutoMergeWaits({ approvals, autoMerge, checkCount: checks.length, enforcement });
  const host = options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl };

  return {
    repository: {
      ...options.settings,
      ...host,
      // ⛔ Squash only. The ruleset's own `allowed_merge_methods` is not reachable through
      //   Alchemy's `pullRequest` rule, so the repository is the only place this holds.
      allowAutoMerge: autoMerge,
      allowMergeCommit: false,
      allowRebaseMerge: false,
      allowSquashMerge: true,
      deleteBranchOnMerge: true,
      name: repository,
      owner,
    },
    ruleset: {
      ...host,
      bypassActors: [...(options.bypassActors ?? [])],
      conditions: { exclude: [...(options.exclude ?? [])], include },
      enforcement,
      name: options.rulesetName ?? DEFAULT_RULESET_NAME,
      owner,
      repository,
      rules: {
        deletion: true,
        nonFastForward: true,
        ...(approvals === undefined
          ? {}
          : {
              pullRequest: {
                dismissStaleReviewsOnPush: true,
                requiredApprovingReviewCount: approvals,
              },
            }),
        ...(checks.length === 0
          ? {}
          : {
              requiredStatusChecks: {
                checks: checks.map((context) => ({ context })),
                strictRequiredStatusChecksPolicy: false,
              },
            }),
      },
      target: 'branch',
    },
  };
}
