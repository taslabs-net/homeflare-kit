# Repository policy

One call that declares a GitHub repository's merge policy and the ruleset that enforces
it: squash-only merges, auto-merge on, head branches deleted, and a ruleset over the
default branch that blocks deletion and force pushes and requires the checks you name.

```ts
import { declareRepoPolicy } from '@homeflare/alchemy/github';
import * as Effect from 'effect/Effect';

Effect.gen(function* () {
  // policy.repository → GitHub.Repository, policy.ruleset → GitHub.RepositoryRuleset
  const policy = yield* declareRepoPolicy('api', {
    owner: 'my-org',
    repository: 'api',
    checks: ['ci', 'secret scan'],
  });
});
```

Provide `GitHub.providers()` **and** `RepositoryRulesetProvider()` from this subpath.
⚠️ **Rewired 2026-09-23**: the ruleset half now composes this house's own
`GitHub.RepositoryRuleset` (see [repository-ruleset.md](./repository-ruleset.md)), not
upstream `GitHub.Ruleset` — every hazard [below](#-the-ruleset-half-has-hazards-of-its-own)
describes upstream's behavior and is now what this bridge exists to close, not what
`declareRepoPolicy` still does.

`repoPolicy(options)` is the same thing without the resources: the two prop objects, pure,
for a test or for a stack that wants to declare them itself.

## What it declares

| where               | property                                 | value           |
| ------------------- | ---------------------------------------- | --------------- |
| `GitHub.Repository` | `allowSquashMerge`                       | `true`          |
| `GitHub.Repository` | `allowMergeCommit`, `allowRebaseMerge`   | `false`         |
| `GitHub.Repository` | `allowAutoMerge`                         | `autoMerge`     |
| `GitHub.Repository` | `deleteBranchOnMerge`                    | `true`          |
| `GitHub.Ruleset`    | `conditions.include`                     | `include`       |
| `GitHub.Ruleset`    | `rules.deletion`, `rules.nonFastForward` | `true`          |
| `GitHub.Ruleset`    | `rules.requiredStatusChecks.checks`      | `checks`        |
| `GitHub.Ruleset`    | `strictRequiredStatusChecksPolicy`       | always `false`  |
| `GitHub.Ruleset`    | `bypassActors`                           | `[]` by default |
| `GitHub.Ruleset`    | `rules.pullRequest`                      | only if asked   |

Everything about the repository that is **not** merge policy — description, topics,
visibility, `hasWiki` — goes in `settings` and is merged underneath. ⛔ The policy fields
are spread after it, and `RepoPolicyRepositorySettings` omits them, so `settings` cannot
re-open a merge method through the back door.

⛔ **`baseUrl` is a top-level option, not a `settings` field.** GitHub Enterprise has to
apply to both resources or to neither; setting it on one would leave the repository on an
Enterprise host and its ruleset on github.com.

## ⛔ Auto-merge with nothing required merges immediately

`gh pr merge --auto` reads like a queue. It is one **only while something is
outstanding**. With no required status check and no required review pending, GitHub
merges the pull request on the spot — the flag does not wait for CI that was never
required to start.

So `repoPolicy` refuses `autoMerge` whenever the ruleset would not hold anything back.
⛔ **Five different inputs produce "nothing outstanding", and all five are refused:**

| input                                     | why it merges anyway                                          |
| ----------------------------------------- | ------------------------------------------------------------- |
| no `checks` and no `requiredApprovals`    | nothing is pending, so `--auto` merges now                    |
| `enforcement: 'disabled'` / `'evaluate'`  | the rules are listed and none of them block — the quiet door  |
| `include: []`                             | the ruleset matches no ref; GitHub still shows it as `active` |
| a blank ref pattern, e.g. `include: ['']` | length is not coverage — matches no ref, past the guard       |
| `exclude` cancelling every `include`      | exclusions win; reads as a narrowing, acts as an off switch   |

★ The last two were found by adversarial review after the first cut shipped. The guard
counted the array and spread `exclude` raw, so `include: ['   ']` and
`include: ['~DEFAULT_BRANCH'], exclude: ['~DEFAULT_BRANCH']` both produced an active
ruleset over nothing with `allowAutoMerge: true` — the same end state the empty-array
guard exists to prevent, through the door beside it.

⚠️ **Exact cancellation only.** Deciding in general whether a glob `exclude` swallows an
`include` means reimplementing GitHub's matcher and being quietly wrong about it. The
helper refuses the decidable case — every `include` pattern appearing verbatim in
`exclude` — and leaves `exclude: ['refs/heads/*']` to the operator.

⚠️ **`bypassActors` is not checked against `autoMerge`, and is `[]` by default.** An actor
you add can bypass the required checks; whether GitHub's auto-merge then lands the pull
request on red was not measured here. Add bypass actors deliberately.

⚠️ The test is "nothing outstanding", not "no checks" — a required review holds the pull
request open just as a required check does, so `requiredApprovals` with an empty `checks`
is allowed.

A repository that has no green run to require yet is a real state; say so explicitly:

```ts
declareRepoPolicy('new-repo', { owner, repository, checks: [], autoMerge: false });
```

The branch is still protected — deletion and force pushes are blocked either way. Turn
`autoMerge` and `checks` on together once there is a green run to name.

## ⛔ Every context in `checks` must always report

A required context that never reports is not "passed", it is **pending**, and the pull
request waits on it forever — auto-merge included, which is the failure that looks like
the tool being broken.

Name an aggregate job that runs `if: always()` and fails when any upstream job did. Do
not name a job behind a `paths:` filter, a matrix leg, or anything a skipped workflow can
silence. Contexts are trimmed, de-duplicated and **sorted**, so writing the same two the
other way round is not a diff.

## ⛔ The ruleset half's hazards — closed by the bridge, still worth reading

The vendor `Ruleset` **cannot be adopted** — a first deploy onto a repository that
already has a ruleset of that name creates a **second** one beside it, both enforcing —
it **never plans a no-op**, and it replaces its `rules` and `bypass_actors` **wholesale**.
None of that ever applied to the repository half.

As of the 2026-09-23 rewire, `declareRepoPolicy`'s ruleset half goes through
`GitHub.RepositoryRuleset`, which probes by name before creating and normalizes before
comparing — see [repository-ruleset.md](./repository-ruleset.md). The wholesale-replace
behavior is unchanged (it is how the underlying `PUT` works), now enforced as a named
refusal rather than a silent drop.

⛔ Read [repo-policy-ruleset-hazards.md](./repo-policy-ruleset-hazards.md) for the full
account of upstream `GitHub.Ruleset`'s own behavior — still accurate for anyone who
declares it directly rather than through this kit.

## Required reviews are opt-in, and `0` is refused

Omit `requiredApprovals` and no `pull_request` rule is declared at all — the house
default, where a pull request is gated by its checks.

`requiredApprovals: 2` declares the rule, with stale reviews dismissed on push.

⛔ `requiredApprovals: 0` is **refused**, not treated as "no reviews". Zero approvals is
the solo-maintainer shape — every change through a pull request, no second person — and
it works only with `require_extra_approval_for_unattributed_changes: false`, which GitHub
defaults to `true` when it is omitted (measured 2026-09-17), blocking the very pull
requests the zero was meant to let through.
⚠️ **Still refused after the 2026-09-23 rewire**, though the underlying resource
(`GitHub.RepositoryRuleset`) can now send that flag — `RepoPolicyOptions` has no field to
ask for it, so `repoPolicy` would otherwise ship a rule that does the opposite of what it
says. A caller that genuinely wants `0` declares `RepositoryRuleset` directly with
`extraApprovalForUnattributedChanges: false` (see
[repository-ruleset.md](./repository-ruleset.md)) instead of going through this helper.

## ★ `strict` is always off, and is not a parameter

"Require branches to be up to date before merging" means every merge to the default
branch invalidates every other open pull request. With auto-merge on, that is a re-run
storm that settles only when the queue empties. The checks still have to pass; they just
do not have to have passed against the very tip.

## ★ `~DEFAULT_BRANCH`, not `refs/heads/main`

`include` defaults to `['~DEFAULT_BRANCH']`, which GitHub resolves per repository. One
policy covers a repo whose default branch is `master` or `trunk`, and renaming the
default branch later does not leave the ruleset pointing at a branch that no longer
exists. Pass your own `include`/`exclude` for anything else.

## ★ Both resources retain

`retain` is already the vendor default for `Repository` and `Ruleset`. The helper pipes
it anyway, so that a vendor change cannot quietly turn "drop this call from the stack"
into "delete the repository" or "unprotect the default branch". Opt into deletion with
`RemovalPolicy.destroy()` at the call site if you really mean it.

`adopt: true` / `adopt: false` pipe Alchemy's adopt policy onto both resources; omitted,
the deploy's own policy decides. ⚠️ It changes nothing about the ruleset hazard above.
