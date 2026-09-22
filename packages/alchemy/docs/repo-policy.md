# Repository policy

One call that declares a GitHub repository's merge policy and the ruleset that enforces
it: squash-only merges, auto-merge on, head branches deleted, and a ruleset over the
default branch that blocks deletion and force pushes and requires the checks you name.

```ts
import { declareRepoPolicy } from '@homeflare/alchemy/github';
import * as Effect from 'effect/Effect';

Effect.gen(function* () {
  // policy.repository → GitHub.Repository, policy.ruleset → GitHub.Ruleset
  const policy = yield* declareRepoPolicy('api', {
    owner: 'my-org',
    repository: 'api',
    checks: ['ci', 'secret scan'],
  });
});
```

Provide `GitHub.providers()`. This subpath ships **no provider of its own** — everything
here composes Alchemy's first-class `GitHub.Repository` and `GitHub.Ruleset`.

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
⛔ **Three different inputs produce "nothing outstanding", and all three are refused:**

| input                                    | why it merges anyway                                          |
| ---------------------------------------- | ------------------------------------------------------------- |
| no `checks` and no `requiredApprovals`   | nothing is pending, so `--auto` merges now                    |
| `enforcement: 'disabled'` / `'evaluate'` | the rules are listed and none of them block — the quiet door  |
| `include: []`                            | the ruleset matches no ref; GitHub still shows it as `active` |

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

## ⛔ The ruleset cannot be adopted — it duplicates

Read out of `alchemy@2.0.0-beta.79`'s own source on 2026-09-22
(`node_modules/alchemy/lib/github/Ruleset.js`):

- `read` returns `undefined` whenever there is no prior `output`. Alchemy's adoption
  routes on what `read` reports, so with no state the engine plans a **create**.
- `reconcile` looks the live ruleset up **only by the id in that output**. With none, it
  calls `createRepoRuleset` unconditionally — it never searches by name.

GitHub permits several rulesets with the same name on one repository, so nothing errors.
The repository quietly ends up with **two `main` rulesets, both enforcing**, and the
second one is the only one Alchemy will ever converge.

**Before the first deploy onto a repository that already has a ruleset:**

```sh
gh api repos/<owner>/<repo>/rulesets --jq '.[] | select(.target=="branch") | "\(.id) \(.name)"'
```

Delete the hand-made ruleset of the same name, or give this one a `rulesetName` of its
own. After the first deploy the state carries the id and every later deploy converges
that one ruleset.

★ **Or take the repository half only.** `repoPolicy` returns the two prop objects
separately, so a stack whose ruleset is already owned by something else can declare the
settings that adopt cleanly and leave the ruleset alone:

```ts
yield * GitHub.Repository('api', repoPolicy({ owner, repository, checks }).repository);
```

⚠️ **`GitHub.Repository` does not share the problem.** Its `reconcile` probes by name and
converges onto whatever is live, so the repository half adopts cleanly on the first
deploy even though the plan prints `create`. The two halves of this helper fail
differently, which is exactly why it is worth writing down.

⚠️ **A reconcile may write on every deploy.** Alchemy compares the live ruleset against
the rule parameters **it** builds, and it builds a strict subset of what GitHub stores —
`required_status_checks`, for instance, comes back carrying defaults Alchemy never sent.
Any such field makes the comparison unequal forever, so the deploy issues an idempotent
`updateRepoRuleset` each time. Not measured against live GitHub here; it is convergence
noise, not drift, but do not read a write in the log as a change.

## Required reviews are opt-in, and `0` is refused

Omit `requiredApprovals` and no `pull_request` rule is declared at all — the house
default, where a pull request is gated by its checks.

`requiredApprovals: 2` declares the rule, with stale reviews dismissed on push.

⛔ `requiredApprovals: 0` is **refused**, not treated as "no reviews". Zero approvals is
the solo-maintainer shape — every change through a pull request, no second person — and
it works only with `require_extra_approval_for_unattributed_changes: false`. Alchemy's
`Ruleset` has no property for that field, and GitHub defaults it to `true` when it is
omitted (measured 2026-09-17), which blocks the very pull requests the zero was meant to
let through. Accepting it would ship a rule that does the opposite of what it says.

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
