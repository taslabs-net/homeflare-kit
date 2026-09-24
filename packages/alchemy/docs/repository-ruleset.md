# `GitHub.RepositoryRuleset`

A bridge resource for the one thing upstream `GitHub.Ruleset` cannot do: find a ruleset
that already exists, by name, before creating a second one with the same name. See
[repository-ruleset.ts](../src/github/repository-ruleset.ts) for the full hazard writeup
and [repo-policy-ruleset-hazards.md](./repo-policy-ruleset-hazards.md) for the upstream
behavior this closes.

```ts
import { RepositoryRuleset, RepositoryRulesetProvider } from '@homeflare/alchemy/github';
import * as GitHub from 'alchemy/GitHub';
import * as Effect from 'effect/Effect';

Effect.gen(function* () {
  yield* RepositoryRuleset('main-ruleset', {
    owner: 'taslabs-net',
    repository: 'widgets',
    name: 'main',
    rules: {
      deletion: true,
      nonFastForward: true,
      pullRequest: {
        requiredApprovingReviewCount: 0,
        allowedMergeMethods: ['squash'],
        extraApprovalForUnattributedChanges: false,
      },
      requiredStatusChecks: { checks: [{ context: 'ci' }, { context: 'secret scan' }] },
    },
  });
});
```

This is a separate `Provider`, registered under its own type string
(`GitHub.RepositoryRuleset`), not inside upstream's `GitHub.Providers` collection — the two
coexist in one stack without any change to upstream's own code.

## Providers

Provide `repoPolicyProviders()` (`@homeflare/alchemy/github`) as the stack's `providers`, not
`GitHub.providers()` and `RepositoryRulesetProvider()` written side by side:

```ts
import { repoPolicyProviders } from '@homeflare/alchemy/github';

// providers: repoPolicyProviders()
```

⛔ **The side-by-side form does not typecheck** — measured 2026-09-24 (homeflare-builds bump PR
6, tsc TS2345), two separate bugs stacked on top of each other:

1. **The layer** still requires `GitHubCredentials` when the two providers are merged plainly:
   `RepositoryRulesetProvider()`'s handlers call `octokitFor`, which needs it, and merging two
   layers does not thread one's output into the other's requirement. `repoPolicyProviders()`
   feeds `GitHub.providers()` into `RepositoryRulesetProvider()` with `Layer.provideMerge`
   instead of a plain merge. `GitHub.providers()` resolves credentials internally and — because
   it chains `provideMerge`, not `provide`, onto its own auth layer — re-exposes
   `GitHubCredentials` in its own output too, so this both satisfies the requirement and keeps
   `GitHub.Providers` available for any `GitHub.Repository`/`GitHub.Ruleset` declared alongside.
2. **The declaration** failed to typecheck on its own, even with the layer fixed, whenever a
   stack body called `RepositoryRuleset` — directly, or via
   `declareRepoPolicy`/`declareRepoBaseline`. `RepositoryRuleset`'s `Resource<>` declaration put
   `GitHubCredentials` in the 5th (`Providers`) type parameter, which puts the credential
   requirement on the DECLARATION itself, not just the provider. A stack body cannot supply
   `GitHubCredentials` this way — `Alchemy.Stack`'s own `ProviderServices` type is a closed
   union that `GitHubCredentials` does not structurally match (see repository-ruleset.ts's file
   header for the full trace against `alchemy/src/Resource.ts` and `alchemy/src/Stack.ts`).
   Upstream's own `GitHub.Ruleset` never makes this mistake: its 5th slot is `GitHub.Providers`
   (the collection tag), never the raw credential service. `RepositoryRuleset` now omits the
   5th parameter, defaulting its declaration requirement to `Provider<RepositoryRuleset>`
   instead.

## Type string: H14

`GitHub.RepositoryRuleset` sits inside upstream's own `GitHub` namespace — the standard's
gap H14, recorded rather than avoided. The alternative was `HomeFlare.GitHub.Ruleset`;
`GitHub.RepositoryRuleset` was chosen because it is GitHub's own term for the object
(`repository-ruleset` in the OpenAPI schema) and reads naturally beside `GitHub.Ruleset`.

## Client: Octokit, not distilled — H15

`@distilled.cloud/github@1.0.0-rc.12` has `createRepoRuleset`/`updateRepoRuleset`, but its
request bodies are `effect/Schema` `S.Struct`s with no field for
`require_extra_approval_for_unattributed_changes` — the flag this whole resource exists
for (see below). Octokit's request builder was MEASURED
(`repository-ruleset-wire.test.ts`, a real `@octokit/rest` instance with a fetch shim, no
network) to forward that untyped key onto the wire unchanged. The client itself is not
hand-rolled: it is built from `GitHubCredentials`/`creds.octokit()`, upstream's own
exported credential service.

## What it models beyond upstream `RulesetProps`

| field                                             | upstream `Ruleset` | this resource            |
| ------------------------------------------------- | ------------------ | ------------------------ |
| `pullRequest.allowedMergeMethods`                 | no                 | yes                      |
| `pullRequest.requiredReviewers`                   | no                 | yes                      |
| `pullRequest.extraApprovalForUnattributedChanges` | no                 | `true`/`false` (K1, H15) |
| `requiredStatusChecks.doNotEnforceOnCreate`       | no                 | yes                      |

`RULE_TYPE_COVERAGE` in `repository-ruleset-constraints.ts` classifies every rule type
Octokit's own installed types know (21 of them — see the file for the 27.0.0-vs-29.0.1
version note) as `'modeled'` or `'refused'`; a live rule of a refused type, or a modeled
`pull_request` the declaration says nothing about, fails the plan by name rather than
being silently dropped by the wholesale `rules` PUT.

## What it refuses, and never does

- **A second same-named ruleset**: `DuplicateRuleset`, before reading either one.
- **Widening `bypassActors`**: refused on update; `undefined` means unmanaged (the live
  value is carried forward unchanged), not "clear it".
- **A live rule of an unmodeled type**, or a live rule of ANY modeled type the
  declaration omits by silence rather than by explicitly saying `false`: refused, naming
  the field. This covers every rule, not only `pull_request`/`requiredStatusChecks` —
  see `undeclaredLiveRuleRefusal`'s own comment for the concrete scenario (forgetting
  `deletion: true` would otherwise silently drop branch-deletion protection) that made
  this the general case rather than a special one.
- **Adding a required check that has never reported success**: refused before any write.
  Checked at the default branch's current tip, then (K2) up to `RECENT_MERGED_PR_LIMIT`
  recent merged PR heads — bounded, not full history (repository-ruleset-octokit.ts). The
  fallback exists because the rendered CI runs on `pull_request` only, so `ci`/`secret
scan`/`CodeQL` never report on the tip itself.
- **A readback mismatch**: after any write, an INDEPENDENT `GET` — never the write's own
  response — is compared against what was sent for the approval count, merge methods and
  the extension flag. A mismatch fails the plan.

## Never-noop, fixed

Upstream `Ruleset#reconcile` compares its desired object against the live GET with a raw
`deepEqual` — no normalization. GitHub does not promise to echo `rules`, checks or merge
methods back in request order, and a live check carries `integration_id: null` where the
request never sent the key. `canonicalizeWireRuleset` (repository-ruleset-form.ts) sorts
every list with no meaningful order (recursively, key order included — see its own
comment for the bug that finding produced) before two wire rulesets are ever compared, so
a repository whose live ruleset already matches the declaration makes **zero** API calls.

## Removal policy

`retain`, always — deleting a ruleset takes an explicit `RemovalPolicy.destroy()` from the
caller, the same as upstream `GitHub.Ruleset`.

## Tests

- `repository-ruleset-lifecycle.test.ts` — a GET-only loopback fake serving the 16 live
  rulesets this family was walked against; the house baseline's real drift against every
  one, and the canonicalization/mutation checks.
- `repository-ruleset-write.test.ts` / `-write-refusals.test.ts` — a write-recording fake:
  what a create sends, zero writes on a noop or a refusal, exactly one update on real
  drift, and the readback check.
- `repository-ruleset-wire.test.ts` — the H15 measurement against a real Octokit instance.
- `repository-ruleset-octokit.test.ts` — the K2 measurement, same real-Octokit-with-fetch-
  shim pattern as the wire test: a context reporting only on a recent merged PR head is
  accepted, one reporting nowhere (tip or any recent merged head) is still refused, and
  one reporting only past `RECENT_MERGED_PR_LIMIT` stays refused too (the bound is real).
- `repository-ruleset-coverage.test.ts` — the rule-type coverage change detector (the
  completeness guarantee itself is enforced by `tsc`, not this file — see its header).
