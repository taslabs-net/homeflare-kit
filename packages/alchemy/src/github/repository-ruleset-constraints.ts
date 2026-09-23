/**
 * Wire-form constraints for `GitHub.RepositoryRuleset`, read off GitHub's own schema rather
 * than invented (vendor-schema's rule: never infer a bound the schema does not state).
 *
 * Provenance: `github/rest-api-description` commit `4377b4f4845b` on `main`
 * (measured 2026-09-23; 12,964,430 bytes; sha256 `b8ca0376…` (prefix as given upstream by the
 * planner — this file does not extend it), `info.version` `1.1.4`).
 * That commit's `pull_request` rule gives `allowed_merge_methods` as the enum
 * `{merge, squash, rebase}` and `required_approving_review_count` as `0–10` — both match
 * what Octokit's own installed types carry (below), so the two agree.
 *
 * ⚠️ MEASURED 2026-09-23, CORRECTING THE PLAN'S OWN CITATION: `@octokit/rest@22.0.1` pulls
 *   `@octokit/openapi-types@29.0.1` in directly, but the REST method PARAMETER TYPES Octokit
 *   actually exposes — `Parameters<Octokit['rest']['repos']['createRepoRuleset']>[0]`, which
 *   `RepositoryRuleType` below is derived from — resolve through a DIFFERENT chain:
 *   `@octokit/plugin-rest-endpoint-methods@17.0.0` → `@octokit/types@16.0.0` →
 *   `@octokit/openapi-types@27.0.0` (`bun install`'s own resolution in this checkout,
 *   confirmed by reading each intermediate `package.json`). 27.0.0's `repository-rule` union
 *   has 21 members, one fewer than 29.0.1's 22 — it has no `license_compliance_scanning`.
 *   `RULE_TYPE_COVERAGE`'s `satisfies` below is written against the 27.0.0 union, because
 *   that is the one `tsc` (and so `bun run check`) actually enforces; a bump that moves
 *   `plugin-rest-endpoint-methods` onto a newer `@octokit/types` will fail this file to
 *   compile on the very day the union changes (S1 test iv), which is the point.
 *
 * ⛔ `require_extra_approval_for_unattributed_changes` appears in NEITHER schema (0 occurrences
 * in the commit above, 0 in either installed `@octokit/openapi-types`) — see
 * repository-ruleset.ts for why it is still modeled (H15) and repository-ruleset-wire.test.ts
 * for whether it survives Octokit's request builder.
 */
import type { Octokit } from '@octokit/rest';

/** The exact vendor/toolchain versions this file's constraints were read against (S38). A
 * re-walk that finds a different version updates this comment and the header above together. */
export const RULESET_SCHEMA_PROVENANCE = {
  alchemy: '2.0.0-beta.79',
  octokitRest: '22.0.1',
  /** The version `Octokit['rest']['repos']['createRepoRuleset']`'s own PARAMETER TYPES
   * actually resolve through (`plugin-rest-endpoint-methods@17.0.0` → `@octokit/types@16.0.0`
   * → this) — not the 29.0.1 `@octokit/rest@22.0.1` pulls in directly. See the file header. */
  octokitOpenapiTypesForRestMethods: '27.0.0',
  restApiDescriptionCommit: '4377b4f4845b',
  restApiDescriptionSha256Prefix: 'b8ca0376',
  restApiDescriptionInfoVersion: '1.1.4',
} as const;

type CreateRulesetParams = NonNullable<
  Parameters<Octokit['rest']['repos']['createRepoRuleset']>[0]
>;
/** The request body Octokit's OWN types accept, minus the two URL-template params — the shape
 * repository-ruleset-form.ts builds `rules`/`conditions`/`bypass_actors` against.
 * ⚠️ `Pick` with explicit keys, NOT `Omit<CreateRulesetParams, 'owner' | 'repo'>` — measured:
 *   `CreateRulesetParams` is an intersection with Octokit's own `RequestParameters`, which
 *   carries a string index signature; `Omit`'s `keyof`-based exclusion collapses through that
 *   signature and produces a type whose named properties no longer survive an object spread
 *   (every spread of the `Omit`'d type type-checked as contributing only `{}`). `Pick` with
 *   literal keys never computes `keyof` over the intersection, so it does not collapse. */
export type CreateRulesetBody = Pick<
  CreateRulesetParams,
  'name' | 'target' | 'enforcement' | 'bypass_actors' | 'conditions' | 'rules'
>;
export type WireRule = NonNullable<CreateRulesetParams['rules']>[number];
export type WirePullRequestRule = Extract<WireRule, { type: 'pull_request' }>;
export type WireStatusChecksRule = Extract<WireRule, { type: 'required_status_checks' }>;

/** Every rule `type` Octokit's OWN installed types know about — derived, not hand-listed, so a
 * vendor upgrade that adds a rule type fails `RULE_TYPE_COVERAGE`'s `satisfies` below at
 * compile time (S1 test iv) rather than silently reaching `reconcile` unrecognized. */
export type RepositoryRuleType = WireRule['type'];

/** `'modeled'` rules this resource can declare and diff; `'refused'` rules it recognizes on a
 * live ruleset but will never send — a live rule of a refused type fails the plan by name
 * (`UndeclaredLiveRule`) instead of being silently dropped by the wholesale `rules` PUT. */
export const RULE_TYPE_COVERAGE = {
  creation: 'modeled',
  update: 'modeled',
  deletion: 'modeled',
  required_linear_history: 'modeled',
  required_signatures: 'modeled',
  pull_request: 'modeled',
  required_status_checks: 'modeled',
  non_fast_forward: 'modeled',
  merge_queue: 'refused',
  required_deployments: 'refused',
  commit_message_pattern: 'refused',
  commit_author_email_pattern: 'refused',
  committer_email_pattern: 'refused',
  branch_name_pattern: 'refused',
  tag_name_pattern: 'refused',
  workflows: 'refused',
  code_scanning: 'refused',
  copilot_code_review: 'refused',
  file_path_restriction: 'refused',
  max_file_path_length: 'refused',
  file_extension_restriction: 'refused',
  max_file_size: 'refused',
} as const satisfies Record<RepositoryRuleType, 'modeled' | 'refused'>;

export const MODELED_RULE_TYPES: readonly RepositoryRuleType[] = (
  Object.keys(RULE_TYPE_COVERAGE) as RepositoryRuleType[]
).filter((type) => RULE_TYPE_COVERAGE[type] === 'modeled');

export const ALLOWED_MERGE_METHODS = ['merge', 'squash', 'rebase'] as const;
export type AllowedMergeMethod = (typeof ALLOWED_MERGE_METHODS)[number];

export const MIN_REQUIRED_APPROVALS = 0;
export const MAX_REQUIRED_APPROVALS = 10;

/** `undefined` when the value is within the schema's `0–10` bound for
 * `required_approving_review_count`; otherwise the refusal reason. Plan-time, not wire-time —
 * schema-codegen's rule: check the form, before the "no previous state" early return. */
export function approvalCountRefusal(count: number): string | undefined {
  if (
    !Number.isInteger(count) ||
    count < MIN_REQUIRED_APPROVALS ||
    count > MAX_REQUIRED_APPROVALS
  ) {
    return (
      `requiredApprovingReviewCount must be a whole number from ${String(MIN_REQUIRED_APPROVALS)} ` +
      `to ${String(MAX_REQUIRED_APPROVALS)} (GitHub's own bound); got ${String(count)}.`
    );
  }
  return undefined;
}

/** `undefined` when every entry is one of the schema's enum and the list is non-empty ("at
 * least one option must be enabled" — the schema's own words); otherwise the refusal reason. */
export function allowedMergeMethodsRefusal(methods: readonly string[]): string | undefined {
  if (methods.length === 0) {
    return 'allowedMergeMethods must name at least one method — GitHub refuses an empty list.';
  }
  const bad = methods.filter((m) => !(ALLOWED_MERGE_METHODS as readonly string[]).includes(m));
  if (bad.length > 0) {
    return `allowedMergeMethods has values GitHub does not accept: ${bad.join(', ')}.`;
  }
  return undefined;
}
