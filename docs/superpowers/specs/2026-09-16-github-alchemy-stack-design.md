# Adopt this repo with Alchemy GitHub (A · 2)

A stack in this repo adopts `taslabs-net/homeflare-kit` and declares an `npm`
Environment. `release.yml` publishes from that environment. We do not import
`@homeflare/alchemy` (that is Forgejo / Proxmox / …). We do not replace
changesets or the workflow YAML.

## Why

Alchemy already has `alchemy/GitHub`. Using it here is how this repo
demonstrates the official provider it tells consumers to prefer. The useful
object is the `npm` Environment: publish is the one job that should sit behind
it. `NPM_TOKEN` stays a GitHub secret — putting it in the stack would write
the token into Alchemy state.

## Resources

`alchemy.run.ts` at the repo root. One `Alchemy.Stack`, `GitHub.providers()`,
`Alchemy.localState()`.

1. `GitHub.Repository` — **adopt** `taslabs-net/homeflare-kit`. Converge only
   safe settings that already match the repo (`deleteBranchOnMerge: true`,
   `hasWiki: false`). Do not declare branch protection; the `main` ruleset
   already owns that, and two owners will fight.
2. `GitHub.Environment("npm")` — name `npm`, deployment branches `main` only.
   No reviewers / wait timer in this pass.

Not in the stack: `GitHub.Secret`, webhooks, comments, Forgejo, R2, a website.

## Apply, state, credentials

`.alchemy/` is already gitignored. State is local until a remote store exists,
so **do not** `alchemy deploy` on every push — a fresh runner would look empty
and fight the last apply.

First apply is local: `bun alchemy deploy` on a machine with GitHub auth
(`alchemy login` / a token that can administer this repo). CI typechecks the
stack. It does not apply.

## Workflow

`release.yml` `jobs.release` gets `environment: npm`. That is the whole
wiring. `NPM_TOKEN` can stay a repository secret for now; GitHub still
exposes repo secrets to an environment job. Moving the token onto the
environment itself is a GitHub UI step, not stack code.

`ci.yml` and `security.yml` stay as they are. No deploy job on `push`.

## Tooling

Root `devDependencies`: `alchemy` and `effect` at the same pins
`@homeflare/alchemy` already uses (`2.0.0-beta.77`, `4.0.0-rc.112`), via the
catalog. Effect overrides already exist at the root. No new runtime
dependency on a published package.

## Tests

- Root `tsconfig.json` `include`s `alchemy.run.ts`, so `bun run types` typechecks it.
- `tests/workflows.test.ts` asserts `release.yml` names `environment: npm`.
- No live GitHub calls in `bun test`.

## Out of scope

Replacing Actions, managing `NPM_TOKEN` in the stack, remote Alchemy state,
`@homeflare/alchemy/forgejo`, auto-deploy on main.
