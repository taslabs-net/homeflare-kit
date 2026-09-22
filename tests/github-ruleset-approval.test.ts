import { expect, test } from 'bun:test';
import { assertSoloApprovals } from '../scripts/github-ruleset-approval.ts';

// ⛔ Missing, unknown, or enabled approvals are unverified, not implicitly off.
test.each([
  undefined,
  null,
  {},
  { required_approving_review_count: 0 },
  { required_approving_review_count: 0, require_extra_approval_for_unattributed_changes: 'false' },
  { required_approving_review_count: 1, require_extra_approval_for_unattributed_changes: false },
])('rejects an unverified approval policy: %j', (parameters) => {
  expect(() => assertSoloApprovals([{ type: 'pull_request', parameters }])).toThrow(
    'GitHub did not confirm zero approvals',
  );
});

test('rejects a missing PR rule', () => {
  expect(() => assertSoloApprovals(undefined)).toThrow();
  expect(() => assertSoloApprovals([{ type: 'deletion' }])).toThrow();
});
