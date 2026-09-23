# `declareRepoPolicy` — the ruleset half's hazards

⚠️ **Status 2026-09-23: `declareRepoPolicy` no longer takes this path.** It is rewired onto
`GitHub.RepositoryRuleset` — the bridge resource in `repository-ruleset.ts` — which closes the
duplicate-on-first-deploy hazard below by probing for a same-named ruleset before ever creating
one, and fixes the never-noop hazard by normalizing before comparing (see
[repository-ruleset.md](./repository-ruleset.md)). Everything on this page is still an accurate
account of upstream `GitHub.Ruleset` itself, kept for anyone who declares it directly rather
than through this kit, and as the record of why the bridge exists.

Everything here is about `GitHub.Ruleset` in `alchemy@2.0.0-beta.79`, not about the
policy this kit declares. It is extracted from [repo-policy.md](./repo-policy.md) so the
reasoning stays whole rather than being shaved to fit a line cap.

⚠️ **`GitHub.Repository` shares none of it.** Its `reconcile` probes by name, converges
onto whatever is live, and `PATCH`es only the fields it holds. The two halves of the
helper fail differently, which is the whole reason this file exists.

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

⛔ **The ruleset half never plans a no-op — measured, not inferred.** Alchemy `deepEqual`s
the live ruleset against the parameters **it** builds, and it builds a strict subset of
what GitHub stores. Read live on 2026-09-22 from this repo's own ruleset, GitHub returns
`required_status_checks.parameters.do_not_enforce_on_create: false` and, on a
`pull_request` rule, `required_reviewers`, `allowed_merge_methods` and
`require_extra_approval_for_unattributed_changes` — none of which Alchemy sends. The
comparison is therefore unequal **forever**, and every deploy issues an idempotent
`updateRepoRuleset`. It is convergence noise, not drift: the write is the same payload
each time. But do not expect a clean plan, and do not read the write as a change.

⛔ **The ruleset's `rules` and `bypass_actors` are replaced wholesale, not merged.**
Alchemy sends the full desired list. Any rule type this helper does not express —
`creation`, `update`, `required_linear_history`, `required_signatures`,
`required_deployments`, tag and file-path rules — is **dropped** from a ruleset Alchemy
owns, as is any bypass actor added by hand. Because the ruleset cannot be adopted this
cannot wipe a pre-existing one on a first deploy; it bites on a ruleset Alchemy created
that someone later edited in the GitHub UI. The repository half does not behave this way:
Alchemy `PATCH`es only the fields it holds, so settings outside `settings` are untouched.
