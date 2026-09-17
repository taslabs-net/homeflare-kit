# GitHub hygiene: the `main` ruleset

The branch protection every taslabs-net repo should converge on, why it is a script and
not an Alchemy resource, and how to roll it out safely.

## The gold-standard shape

★ **Not invented.** This is `taslabs-net/homeflare-kit`'s live ruleset, read read-only via
`gh api repos/taslabs-net/homeflare-kit/rulesets/23471358` on 2026-09-16 — the repository
this file lives in, already enforcing exactly this:

| rule                     | value                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| target                   | `branch`, `ref_name.include: ["~DEFAULT_BRANCH"]`                                                                                                              |
| enforcement              | `active`                                                                                                                                                       |
| `deletion`               | present — the default branch cannot be deleted                                                                                                                 |
| `non_fast_forward`       | present — no force pushes                                                                                                                                      |
| `pull_request`           | `required_approving_review_count: 0` (solo PRs), `dismiss_stale_reviews_on_push: true`, no code-owner review, `allowed_merge_methods: [squash, merge, rebase]` |
| `required_status_checks` | `[{context: "ci"}, {context: "secret scan"}]`                                                                                                                  |
| `bypass_actors`          | `[]` — nobody, including admins, may bypass                                                                                                                    |

⚠️ **Solo PRs are deliberate, not a placeholder.** `required_approving_review_count: 0`
still forces every change through a pull request — no direct pushes to `main`, no
force-pushing over history — without requiring a second person on a one-maintainer repo.
Raise it once a repo has more than one regular reviewer; the ruleset does not enforce
that for you.

`ci` is the [aggregate check](../.github/workflows/ci.yml) every job funnels into, and
`secret scan` is [`security.yml`](../.github/workflows/security.yml)'s gitleaks job — see
[docs/releasing.md](./releasing.md) for why both are required and how the release bot's
parked runs get approved around them.

## Required checks: default OFF

`scripts/apply-main-ruleset.ts --require-checks ctx,ctx` is the ONLY way this repo's
helper adds a `required_status_checks` rule, and the flag has no default value. A repo
with no green CI run yet cannot require one — that locks out the PR that would fix it,
which is exactly what happened by hand on `taslabs-net/homeflare-alerts` (ruleset created
2026-09-16, `enforcement: disabled`, no `required_status_checks` rule at all: read via
`gh api repos/taslabs-net/homeflare-alerts/rulesets/23552096`).

**Rollout, in order:**

1. Get one green `ci` run and one green `secret scan` run on the repo's default branch.
2. `bun run github:apply-ruleset -- --repo <name> --dry-run` — prints what would change,
   writes nothing.
3. `bun run github:apply-ruleset -- --repo <name>` — applies deletion/force-push/solo-PR
   protection with required checks still OFF.
4. `bun run github:apply-ruleset -- --repo <name> --require-checks "ci,secret scan"` —
   now a PR cannot merge without both.

## Why branch protection is not declared in Alchemy

`alchemy.run.ts` adopts this repo's `GitHub.Repository` and `GitHub.Environment` — but
not branch protection, and the comment there says only "the `main` ruleset already owns
it." Two things back that up, verified by reading `alchemy@2.0.0-beta.77`'s own source
(`node_modules/alchemy/src/github/`) on 2026-09-16, not by trusting the comment:

⛔ **There is no ruleset resource to declare.** `alchemy/GitHub` exports `Repository`,
`Environment`, `Secret`, `Secrets`, `Variable`, `Variables`, `Webhook`, `Comment`, and
auth/credential plumbing — nothing that reads, creates, or diffs a repository ruleset or
classic branch protection. Wanting to declare it does not make it declarable; adding it
would mean forking or upstreaming a new Alchemy resource, not writing a few lines here.

★ **Even if it existed, this would stay imperative.** A ruleset is a security control
whose whole point is that it constrains what CAN happen to the branch a deploy runs from
— including, transitively, an Alchemy deploy's own commits. Folding it into the same
stack that `alchemy.run.ts` deploys makes "loosen the ruleset" a one-line diff that ships
through the same pipeline the ruleset exists to gate, and a bad `terraform apply`-style
mistake here is "this repo's security posture," not "a Cloudflare resource is briefly
misconfigured." `scripts/apply-main-ruleset.ts` runs by hand, reads the live state before
writing (see below), and is not part of `bun run check` or any CI job for the same
reason `alchemy.run.ts` is deployed by a human running `--stage live`, not by CI.

## The helper script

`scripts/apply-main-ruleset.ts` (CLI, upsert decision) and `scripts/github-ruleset.ts`
(the ruleset shape, and the `@octokit/rest` calls) upsert the shape above onto one named
`taslabs-net` repository. `@octokit/rest` is already a transitive dependency of `alchemy`
here; this is GitHub's own SDK, not a hand-rolled `fetch`.

Safety properties, each backed by a test in `tests/apply-main-ruleset.test.ts`:

- ⛔ **Fails closed without `--repo`.** No default target — a maintenance script that
  could accidentally run against the wrong repo, or none, is worse than one that refuses.
- ⛔ **Fails closed without a token.** Reads `GITHUB_TOKEN` or `GH_TOKEN` from the
  environment at run time; nothing is ever written to source or to any state file.
- ⛔ **`--require-checks` with no contexts is an error, not "off".** Ambiguity fails
  closed rather than silently doing nothing.
- ⛔ **Never widens `bypass_actors`.** There is no flag for it. Creating a ruleset starts
  at `[]`; updating one reads the CURRENT value back from GitHub first and passes it
  through unchanged, because this script has no opinion on who may bypass a rule it did
  not add.
- ★ **Upsert, not clobber.** It lists existing rulesets, and only creates one when none
  named `main` targets `branch` — re-running it converges rather than duplicating.

## What this does not cover

This is branch protection for `main` only. It does not manage collaborators, teams,
webhooks, Actions permissions, or Dependabot — each of those is either already an
Alchemy resource (`GitHub.Secret`, `GitHub.Webhook`, …) or, like this one, not yet a
resource at all and therefore out of scope for this document.
