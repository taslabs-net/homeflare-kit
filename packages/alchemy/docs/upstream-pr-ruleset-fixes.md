# Draft: two upstream PRs to `alchemy-run/alchemy`

**Not posted.** Posting either is Tim's decision (alchemy-provider-standard's boundary:
"posting anything to an upstream repository is Tim's decision. Ask first, with options
and a recommendation."). This is the recommendation, drafted 2026-09-23 alongside
`GitHub.RepositoryRuleset`, the house's stopgap for PR 1 below.

## PR 1: `GitHub.Ruleset` — adopt by name, normalize before comparing

**Target**: `packages/alchemy/src/GitHub/Ruleset.ts`, pinned tag `v2.0.0-beta.79`.

**Problem** (measured from the source, see `repository-ruleset.ts`'s header):
`reconcile`'s `observed` lookup is `output === undefined ? undefined :
getRuleset(news, output.rulesetId)` — with no prior state it never searches by name, so a
first deploy onto a repository that already has a same-named ruleset creates a **second**
one. Separately, the `deepEqual` compare in the same function has no normalization: rule
order, `allowed_merge_methods` order, check order, and `integration_id: null` vs an
omitted key all make a matching live ruleset compare unequal, so a converged stack issues
an idempotent `updateRepoRuleset` on every single plan.

**Proposed fix**, following the shape `RepositoryRuleset` already proves out:

1. `read`, with `output === undefined`: list the repo's rulesets
   (`octokit.paginate(getRepoRulesets, { includes_parents: false })`), filter by
   `name`/`target`. Zero matches → `undefined`. One → `GET` by id, wrap `Unowned(attrs)`
   (H1: identical is not automatically ours). More than one → a typed failure naming
   every id, before reading any of them — `alchemy`'s `Data.TaggedError` convention.
2. `reconcile`'s observe step: the same name-probe when `output` is absent.
3. Normalize both sides of the `deepEqual` (or switch to Alchemy's own `deepEqual` plus a
   canonicalization pass) before comparing: sort `rules` by `type`, sort
   `allowed_merge_methods`, sort `required_status_checks` by context, and drop
   `integration_id: null` before comparing.

**Compatibility**: additive. A caller with no prior state today gets a `create`; after
the fix, a repository with an existing same-named ruleset gets an adopt instead — a
behavior change, but the current behavior (silently making a duplicate) is the bug.

**House stopgap**: `GitHub.RepositoryRuleset` in this package, retained until this lands
and releases, then retired per alchemy-provider-standard's retirement steps (drop the kit
declaration, declare `GitHub.Ruleset` with `adopt(true)`, the fixed read-by-name adopts
it).

## PR 2: `GitHub.RulesetProps` — the fields this house needed and upstream lacks

**Target**: same file, same tag.

**Fields to add** to `rules.pullRequest`:

- `allowedMergeMethods?: ('merge' | 'squash' | 'rebase')[]` — GitHub's own schema
  (`repository-rule-pull-request`, both `@octokit/openapi-types` 27.0.0 and 29.0.1 this
  checkout has read) already carries `allowed_merge_methods`; Alchemy's props do not.
- `requiredReviewers?: { filePatterns: string[]; minimumApprovals: number; reviewer: {
id: number; type: 'Team' } }[]` — same schema, `required_reviewers` (beta per GitHub's
  own doc comment, but already live and typed).

And to `rules.requiredStatusChecks`:

- `doNotEnforceOnCreate?: boolean` — the schema's `do_not_enforce_on_create`.

**Deliberately NOT proposed**: `require_extra_approval_for_unattributed_changes`. It
appears in ZERO of the schemas this house has read — not GitHub's own
`rest-api-description` at commit `4377b4f4845b` (measured 2026-09-23, 0 occurrences), not
either installed `@octokit/openapi-types` (27.0.0 or 29.0.1). It is real and round-trips
live (this estate's own rulesets carry it — LIVE SURVEY 2026-09-23), but proposing a
field GitHub has not documented anywhere upstream can point to is a different, weaker
kind of PR. `GitHub.RepositoryRuleset` sends it as an untyped extra key on the request
body (H15, measured in `repository-ruleset-wire.test.ts`) precisely because it has no
home in a typed prop upstream would accept today.

**Compatibility**: additive, no behavior change for an existing caller.

## Sequencing

PR 2 is safe to post on its own, any time — it adds optional fields nothing currently
sets. PR 1 is the one worth discussing with a maintainer first: the adopt-by-name
behavior change, even though it fixes a bug, is a visible difference for anyone who
relied on (or never noticed) the duplicate-ruleset behavior.
