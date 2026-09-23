# Dependabot, and how a kit release reaches a consumer

`repo-shape` renders `.github/dependabot.yml` and `.github/workflows/dependabot-automerge.yml`
together. The first opens one pull request per kit release in each consumer (the
`homeflare` group); the second arms GitHub's auto-merge on that pull request and on nothing
else. The branch ruleset's required checks decide whether it merges.

**Status (2026-09-22): the Actions half works; the bun half is blocked upstream.** See
[the blocker](#the-blocker-bunlock-lockfileversion-2) — it is the trigger for everything
below doing anything.

## Why

Merging and releasing a kit change are automated. Bumping a consumer was not, and it is the
leg that silently stops: measured 2026-09-22, `homeflare-proxmox` and `homeflare-mini`
pinned `@homeflare/alchemy` 0.13.0 and `@homeflare/config` 0.5.1 while the kit had published
0.19.1 and 0.8.0. Tim's decision (2026-09-23): kit releases reach consumers by Dependabot,
grouped, checked daily, merged on green; no GitHub organization and no tokens.

## What each rendered choice rests on

Read on 2026-09-22 from GitHub's docs and from dependabot-core's source at v0.397.0.

| Choice                                                     | Why                                                                                                                                             | Source                                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| One bun block, daily                                       | Two blocks for one ecosystem and target branch must have "no overlap in directories defined", so a group cannot have its own schedule           | [options reference: `directories`][options]                                                            |
| `cooldown.exclude: ['@homeflare/*']`                       | Dependabot applies a 3-day cooldown "even when `cooldown` is not configured"; without the exclude, a release waits three days                   | [options reference: `cooldown`][options]                                                               |
| `cooldown.default-days: 7`                                 | Keeps third-party updates to roughly the weekly pace they had, by age rather than by calendar                                                   | same                                                                                                   |
| `homeflare` group first, no `update-types`                 | "If a dependency matches more than one rule, it's included in the first group that it matches"; a kit release moves as one set                  | [options reference: `groups`][options]                                                                 |
| `daily` means Monday–Friday                                | "Use `daily` to run on every weekday, Monday to Friday"                                                                                         | [options reference: `schedule`][options]                                                               |
| Auto-merge by `gh pr merge --auto`                         | GitHub's documented pattern for Dependabot pull requests                                                                                        | [Automating Dependabot with GitHub Actions][automating]                                                |
| No `dependabot/fetch-metadata`                             | The same page labels it "not certified by GitHub"; the house CI is first-party only                                                             | same                                                                                                   |
| Group recognised by branch name                            | `dependabot/bun/homeflare-<10 hex>`: prefix, package manager, directory (root collapses), then group name and the first 10 hex of an MD5 digest | dependabot-core `common/lib/dependabot/pull_request_creator/branch_namer/dependency_group_strategy.rb` |
| `contents: write` + `pull-requests: write` on the job only | A Dependabot-started run gets a read-only `GITHUB_TOKEN` unless the `permissions` key raises it; these two are what GitHub's own example grants | [Troubleshooting Dependabot on GitHub Actions][troubleshoot]                                           |
| `--squash`                                                 | The house policy (`declareRepoPolicy`) allows squash merges only                                                                                | `@homeflare/alchemy` `repo-policy-form.ts`                                                             |

## Where Dependabot runs, and the billing lock

GitHub-hosted runners are refused for the estate's private repositories (billing lock,
measured 2026-09-22). Dependabot is not affected, for two documented reasons and one
measurement:

- Dependabot "will always run on GitHub Actions, bypassing both Actions policy checks and
  disablement" ([automating]).
- "Running Dependabot on standard GitHub-hosted or self-hosted runners **does not** count
  towards your included GitHub Actions minutes" ([about Dependabot on Actions][concepts]).
- **Measured:** at 18:30Z a private estate repository's ordinary `ubuntu-latest` job was
  refused with "The job was not started because recent account payments have failed or
  your spending limit needs to be increased". At 19:56Z the same account's private
  monorepo ran a `Dependabot Updates` job on a GitHub-hosted runner for 17 minutes; it
  failed on a dependency resolution error, not on billing.

⛔ **It cannot run on the mini, and does not need to.** A self-hosted Dependabot runner must
be "Linux", "x64 architecture", with "Docker installed with access for the runner users",
and a standalone repository's runner must carry the `dependabot` label
([Dependabot on Actions reference][reference], [self-hosted how-to][selfhosted]). The mini's
runners are arm64 containers with no Docker socket, by design. Enabling "Dependabot on
self-hosted runners" with no such runner leaves jobs "queued indefinitely".

## The blocker: `bun.lock` lockfileVersion 2

Every estate repository's `bun.lock` is `"lockfileVersion": 2` (bun 1.4 raised the default;
oven-sh/bun pull request 31539). dependabot-core bundles bun 1.3.14 and sets
`MAX_SUPPORTED_LOCKFILE_VERSION = 1` (`bun/lib/dependabot/bun/bun_package_manager.rb`), so
the bun update fails before it reads a manifest. Measured on this repository, 2026-09-22
21:17Z, eight seconds after `.github/dependabot.yml` first landed:

    ERROR Unsupported bun.lock 'lockfileVersion' 2 in /bun.lock.
          The bun version Dependabot runs supports up to 1.

The github-actions update in the same push succeeded.

**TRIGGER:** dependabot/dependabot-core pull request 16071 ("bun: support bun.lock
lockfileVersion 2 and 3", open since 2026-08-28) is merged and deployed, and a
`Dependabot Updates` run for `bun` in an estate repository completes without that error.
Until then a kit release is bumped in each consumer by hand.

⛔ **Not a workaround: writing lockfileVersion 1.** bun 1.4's writer always emits the
current version, and version 2 is where bun enforces integrity for off-registry tarballs
and rejects unsafe git tags. Downgrading the lockfile to suit Dependabot gives both up.

## What still needs a person

- **A kit release that changes what `@homeflare/config` renders.** The group's pull
  request fails the drift test by design ([repo-shape.md](repo-shape.md), "Bumping
  `@homeflare/config` will go red before it goes green"). Run `bun run repo-shape:refresh`
  on the Dependabot branch and push; the push starts CI as any person's push does.
  ⛔ The workflow cannot do it: "events triggered by the `GITHUB_TOKEN` will not create a
  new workflow run" ([GITHUB_TOKEN][token]), so a refreshed commit pushed with it would
  never get its checks.
- **A release whose plan changes.** A merged bump deploys nothing, but the next deploy of
  that consumer applies whatever the new kit plans. Read the plan before deploying.

⚠️ **The merge itself starts no workflow on `main`.** Auto-merge armed with `GITHUB_TOKEN`
merges as that token, and its push triggers nothing. The rendered `ci.yml` has no push
trigger anyway, and a bump carries no changeset, so nothing is lost — but a repository that
adds a `push: main` workflow should know it will not run for these merges.

⚠️ **`open-pull-requests-limit: 5` is per block.** Five stale third-party pull requests
could, in principle, hold the group back. dependabot-core runs grouped updates before
ungrouped ones in each job (`group_update_all_versions.rb`), but the limit is enforced by
the service, whose code is not public — so this is reasoned, not measured.

## Proving it on a repository

The run appears as event `dynamic`, workflow `Dependabot Updates`, within seconds of a
`dependabot.yml` change reaching the default branch (measured 2026-09-22: 8 s):

    gh run list -R <owner>/<repo> --event dynamic --limit 10 \
      --json workflowName,name,conclusion,createdAt

A failed run's reason is in its job log (`gh run view <id> --log`), not in its annotation,
which only says "The updater encountered one or more errors".

[options]: https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference
[automating]: https://docs.github.com/en/code-security/dependabot/working-with-dependabot/automating-dependabot-with-github-actions
[troubleshoot]: https://docs.github.com/en/code-security/reference/supply-chain-security/troubleshoot-dependabot/dependabot-on-actions
[concepts]: https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-on-actions
[reference]: https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions
[selfhosted]: https://docs.github.com/en/code-security/dependabot/maintain-dependencies/managing-dependabot-on-self-hosted-runners
[token]: https://docs.github.com/en/actions/concepts/security/github_token
