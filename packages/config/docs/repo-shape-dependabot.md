# Dependabot, and how a kit release reaches a consumer

`repo-shape` renders `.github/dependabot.yml`. It watches everything EXCEPT the packages
this kit publishes: an `ignore` entry names `@homeflare/*` in the bun block, so Dependabot
never proposes them.

**Retired 2026-09-23 (kit auto-bumper design, Tim): the `homeflare` group and the
rendered `dependabot-automerge.yml`.** They used to be how a kit release reached a
consumer — grouped, checked daily, merged on green. `taslabs-net/homeflare-bumper` does
that job now, dispatched from this repo's own `release.yml` (`notify-consumers`) with a
schedule backstop. The `ignore` below exists **so the two never compete**: without it, a
Dependabot bump and a bumper bump could open two pull requests for the same version at
once.

**Status (2026-09-22): the Actions half works; the bun half is blocked upstream regardless
of the ignore.** See [the blocker](#the-blocker-bunlock-lockfileversion-2).

## Why

Merging and releasing a kit change are automated. Bumping a consumer was not, and it is the
leg that silently stops: measured 2026-09-22, `homeflare-proxmox` and `homeflare-mini`
pinned `@homeflare/alchemy` 0.13.0 and `@homeflare/config` 0.5.1 while the kit had published
0.19.1 and 0.8.0. Tim's decision (2026-09-23): `homeflare-bumper` carries a kit release into
every consumer; Dependabot's job is everything else.

## What each rendered choice rests on

Read on 2026-09-22 from GitHub's docs and from dependabot-core's source at v0.397.0.

| Choice                                        | Why                                                                                                                                           | Source                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `ignore: [{dependency-name: '@homeflare/*'}]` | `dependency-name`, "optionally using `*` to match zero or more characters" — stops Dependabot proposing what the bumper owns                  | [options reference: `ignore`][options]      |
| `cooldown.default-days: 7`                    | Third-party updates are proposed once a release is a week old, by age rather than by calendar                                                 | [options reference: `cooldown`][options]    |
| One bun block, weekly                         | Two blocks for one ecosystem and target branch must have "no overlap in directories defined" — moot now, kept for the directories split below | [options reference: `directories`][options] |

The bumper's own citations — `gh pr merge --auto`'s CLEAN/UNSTABLE trap, the App's token
scoping, and everything else that used to live in this repo's now-deleted
`dependabot-automerge.yml` — moved with it, to `taslabs-net/homeflare-bumper` (not
measured here whether its docs have landed yet; check that repo directly).

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

- **A kit release whose plan changes.** A merged bump — from either path — deploys
  nothing, but the next deploy of that consumer applies whatever the new kit plans. Read
  the plan before deploying.
- **Whatever the bumper itself hands off.** Its own auto-merge refusals, App setup, and
  key rotation are documented where it lives, `taslabs-net/homeflare-bumper` — not here.

⚠️ **`open-pull-requests-limit: 5` is per block.** Five stale third-party pull requests
could, in principle, crowd out a new one. dependabot-core runs grouped updates before
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
[concepts]: https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-on-actions
[reference]: https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions
[selfhosted]: https://docs.github.com/en/code-security/dependabot/maintain-dependencies/managing-dependabot-on-self-hosted-runners
