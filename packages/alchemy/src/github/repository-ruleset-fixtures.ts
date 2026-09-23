/**
 * The 16 live GitHub rulesets this family was walked against — captured 2026-09-23 by the
 * planner's read-only `gh api` survey (owner `taslabs-net`; no secrets in any of these rows,
 * only ruleset configuration GitHub already shows to any collaborator). Used by
 * repository-ruleset-lifecycle.test.ts as a GET-only loopback fake, so a real baseline diff is
 * checked against real shapes rather than a hand-picked "easy" fixture.
 *
 * Two simplifications from the raw survey, both noted here rather than silently taken:
 * - `aimto`'s `secret scan (any app)` context is recorded as plain `secret scan` — the survey
 *   did not say the wire context string differs, only that the workflow's check-suite scope
 *   does; nothing in this family reads that scope, so it would not change any comparison.
 * - `updated_at` is a placeholder ISO date derived from the survey's two-digit day, not the
 *   real timestamp (which the survey did not capture to the second).
 */
import type { RulesetRecord } from './repository-ruleset-probe.ts';

const conditions = { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } };

const pullRequestRule = (extraApprovalUnattributed: boolean) => ({
  type: 'pull_request',
  parameters: {
    required_approving_review_count: 0,
    dismiss_stale_reviews_on_push: true,
    require_code_owner_review: false,
    require_last_push_approval: false,
    required_review_thread_resolution: false,
    required_reviewers: [],
    allowed_merge_methods: ['merge', 'squash', 'rebase'],
    require_extra_approval_for_unattributed_changes: extraApprovalUnattributed,
  },
});

const statusChecksRule = (checks: readonly string[]) => ({
  type: 'required_status_checks',
  parameters: {
    required_status_checks: checks.map((context) => ({ context, integration_id: null })),
    strict_required_status_checks_policy: false,
    do_not_enforce_on_create: false,
  },
});

const STANDARD_CHECKS = ['ci', 'secret scan'] as const;

interface FixtureInput {
  readonly repo: string;
  readonly id: number;
  readonly day: string;
  readonly enforcement?: 'active' | 'disabled';
  readonly checks?: readonly string[];
  readonly extraApprovalUnattributed: boolean;
}

function fixture(input: FixtureInput): RulesetRecord {
  return {
    id: input.id,
    name: 'main',
    target: 'branch',
    source_type: 'Repository',
    enforcement: input.enforcement ?? 'active',
    bypass_actors: [],
    conditions,
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      pullRequestRule(input.extraApprovalUnattributed),
      ...(input.checks === undefined ? [] : [statusChecksRule(input.checks)]),
    ],
    created_at: `2026-09-${input.day}T00:00:00Z`,
    updated_at: `2026-09-${input.day}T00:00:00Z`,
  };
}

/** Keyed by repo name — every row from the LIVE SURVEY's per-repo ruleset table. */
export const LIVE_RULESET_FIXTURES: Readonly<Record<string, RulesetRecord>> = {
  homeflare: fixture({
    repo: 'homeflare',
    id: 23613456,
    day: '17',
    extraApprovalUnattributed: true,
  }),
  aimto: fixture({
    repo: 'aimto',
    id: 23616354,
    day: '17',
    checks: STANDARD_CHECKS,
    extraApprovalUnattributed: false,
  }),
  alerts: fixture({
    repo: 'alerts',
    id: 23552096,
    day: '17',
    checks: STANDARD_CHECKS,
    extraApprovalUnattributed: false,
  }),
  anyauth: fixture({
    repo: 'anyauth',
    id: 23478011,
    day: '15',
    enforcement: 'disabled',
    extraApprovalUnattributed: true,
  }),
  blog: fixture({
    repo: 'blog',
    id: 23598797,
    day: '17',
    checks: STANDARD_CHECKS,
    extraApprovalUnattributed: false,
  }),
  desktop: fixture({ repo: 'desktop', id: 23601674, day: '17', extraApprovalUnattributed: true }),
  kit: fixture({
    repo: 'kit',
    id: 23471358,
    day: '15',
    checks: STANDARD_CHECKS,
    extraApprovalUnattributed: false,
  }),
  landscape: fixture({
    repo: 'landscape',
    id: 23555162,
    day: '17',
    checks: STANDARD_CHECKS,
    extraApprovalUnattributed: false,
  }),
  memory: fixture({
    repo: 'memory',
    id: 23616353,
    day: '17',
    checks: STANDARD_CHECKS,
    extraApprovalUnattributed: false,
  }),
  mini: fixture({
    repo: 'mini',
    id: 23837649,
    day: '22',
    checks: STANDARD_CHECKS,
    extraApprovalUnattributed: false,
  }),
  'openbao-plugins': fixture({
    repo: 'openbao-plugins',
    id: 23657714,
    day: '18',
    checks: STANDARD_CHECKS,
    extraApprovalUnattributed: false,
  }),
  openbao: fixture({
    repo: 'openbao',
    id: 23580452,
    day: '17',
    checks: STANDARD_CHECKS,
    extraApprovalUnattributed: false,
  }),
  proxmox: fixture({
    repo: 'proxmox',
    id: 23837620,
    day: '22',
    checks: STANDARD_CHECKS,
    extraApprovalUnattributed: false,
  }),
  secrets: fixture({
    repo: 'secrets',
    id: 23616342,
    day: '17',
    checks: STANDARD_CHECKS,
    extraApprovalUnattributed: false,
  }),
  'subnet-calc': fixture({
    repo: 'subnet-calc',
    id: 23580453,
    day: '17',
    checks: STANDARD_CHECKS,
    extraApprovalUnattributed: false,
  }),
  wiki: fixture({
    repo: 'wiki',
    id: 23580451,
    day: '17',
    checks: STANDARD_CHECKS,
    extraApprovalUnattributed: false,
  }),
};

/** repos with NO live ruleset at all (measured: 0 rulesets), per the survey's RULESETS section. */
export const REPOS_WITH_NO_RULESET: readonly string[] = ['builds', 'memos'];
