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

Provide **both** `GitHub.providers()` (for `GitHub.Repository`, if declared alongside) and
`RepositoryRulesetProvider()` — this is a separate `Provider`, registered under its own
type string (`GitHub.RepositoryRuleset`), not inside upstream's `GitHub.Providers`
collection. The two coexist in one stack without any change to upstream's own code.

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

| field                                             | upstream `Ruleset` | this resource      |
| ------------------------------------------------- | ------------------ | ------------------ |
| `pullRequest.allowedMergeMethods`                 | no                 | yes                |
| `pullRequest.requiredReviewers`                   | no                 | yes                |
| `pullRequest.extraApprovalForUnattributedChanges` | no                 | `false` only (H15) |
| `requiredStatusChecks.doNotEnforceOnCreate`       | no                 | yes                |

`RULE_TYPE_COVERAGE` in `repository-ruleset-constraints.ts` classifies every rule type
Octokit's own installed types know (21 of them — see the file for the 27.0.0-vs-29.0.1
version note) as `'modeled'` or `'refused'`; a live rule of a refused type, or a modeled
`pull_request` the declaration says nothing about, fails the plan by name rather than
being silently dropped by the wholesale `rules` PUT.

## What it refuses, and never does

- **A second same-named ruleset**: `DuplicateRuleset`, before reading either one.
- **Widening `bypassActors`**: refused on update; `undefined` means unmanaged (the live
  value is carried forward unchanged), not "clear it".
- **A live rule of an unmodeled type**, or a live `pull_request`/`requiredStatusChecks`
  the declaration omits (rather than explicitly saying `false`): refused, naming the
  field.
- **Adding a required check that has never reported success** on the default branch's
  current tip (checks + statuses): refused before any write. Documented limitation: this
  checks the current tip only, not full history (repository-ruleset-octokit.ts).
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
- `repository-ruleset-coverage.test.ts` — the rule-type coverage change detector (the
  completeness guarantee itself is enforced by `tsc`, not this file — see its header).
