/**
 * (iv) `RULE_TYPE_COVERAGE` is a compile-time exhaustiveness check by construction: it is typed
 * `as const satisfies Record<RepositoryRuleType, 'modeled' | 'refused'>`, and `RepositoryRuleType`
 * is derived from Octokit's OWN installed rule-type union (repository-ruleset-constraints.ts),
 * not hand-listed. When a future `@octokit/rest`/`@octokit/types` upgrade adds a rule type,
 * `bun run check`'s `tsc` step fails on repository-ruleset-constraints.ts — the object literal
 * is missing a required key — before `reconcile` can ever see a rule it does not recognize.
 *
 * ⚠️ THIS FILE CANNOT DEMONSTRATE THAT FAILURE AT RUNTIME. `bun:test` does not type-check; a
 *   `// @ts-expect-error` fixture proving the object literal rejects an incomplete map would
 *   need its own file kept permanently out of `tsc`'s project (or it would break the build it
 *   is trying to test), which is more machinery than the guarantee is worth. What this file
 *   DOES check at runtime: the count and shape of the union `tsc` is enforcing right now, as a
 *   change detector — a value this test did not expect means the installed Octokit version
 *   moved and `RULE_TYPE_COVERAGE`'s completeness (already enforced separately, by `tsc`) has a
 *   new member to classify as `'modeled'` or `'refused'` on purpose, not by accident.
 */
import { describe, expect, test } from 'bun:test';
import {
  MODELED_RULE_TYPES,
  RULESET_SCHEMA_PROVENANCE,
  RULE_TYPE_COVERAGE,
} from './repository-ruleset-constraints.ts';

const EXPECTED_TYPES = [
  'creation',
  'update',
  'deletion',
  'required_linear_history',
  'required_signatures',
  'pull_request',
  'required_status_checks',
  'non_fast_forward',
  'merge_queue',
  'required_deployments',
  'commit_message_pattern',
  'commit_author_email_pattern',
  'committer_email_pattern',
  'branch_name_pattern',
  'tag_name_pattern',
  'workflows',
  'code_scanning',
  'copilot_code_review',
  'file_path_restriction',
  'max_file_path_length',
  'file_extension_restriction',
  'max_file_size',
] as const;

describe('RULE_TYPE_COVERAGE tracks Octokit-installed rule types exactly', () => {
  test("classifies every one of the 21 rule types this checkout's Octokit knows", () => {
    expect(Object.keys(RULE_TYPE_COVERAGE).sort()).toEqual([...EXPECTED_TYPES].sort());
  });

  test('exactly the 8 upstream `GitHub.Ruleset` models are "modeled", the rest "refused"', () => {
    const modeled = new Set(MODELED_RULE_TYPES);
    expect(modeled).toEqual(
      new Set([
        'creation',
        'update',
        'deletion',
        'required_linear_history',
        'required_signatures',
        'pull_request',
        'required_status_checks',
        'non_fast_forward',
      ]),
    );
    for (const type of EXPECTED_TYPES) {
      if (!modeled.has(type)) expect(RULE_TYPE_COVERAGE[type]).toBe('refused');
    }
  });

  test('the provenance record names the version tcs actually checked this file against', () => {
    // The 27.0.0 vs 29.0.1 split is the point (see repository-ruleset-constraints.ts's header):
    // `@octokit/rest` pulls 29.0.1 directly, but the REST method parameter types this family
    // derives `RepositoryRuleType` from resolve through a different, older chain.
    expect(RULESET_SCHEMA_PROVENANCE.octokitOpenapiTypesForRestMethods).toBe('27.0.0');
    expect(RULESET_SCHEMA_PROVENANCE.octokitRest).toBe('22.0.1');
    expect(RULESET_SCHEMA_PROVENANCE.alchemy).toBe('2.0.0-beta.79');
  });
});
