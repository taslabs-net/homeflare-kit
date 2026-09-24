---
'@homeflare/alchemy': patch
---

`GitHub.RepositoryRuleset`'s `Resource<>` declaration put `GitHubCredentials` in its 5th
(`Providers`) type parameter, which puts that credential requirement on every `yield*
RepositoryRuleset(...)` call site — including inside `declareRepoPolicy`/`declareRepoBaseline`.
A stack body cannot supply `GitHubCredentials` itself (`Alchemy.Stack`'s own `ProviderServices`
type is a closed union `GitHubCredentials` does not structurally match), so any consumer whose
stack body calls `declareRepoPolicy`/`declareRepoBaseline` — or declares `RepositoryRuleset`
directly — failed `tsc` (measured 2026-09-24: homeflare-builds bumping to 0.27.4, TS2345).

Verified against upstream `alchemy@2.0.0-beta.79`'s own `GitHub.Ruleset`
(`node_modules/alchemy/src/GitHub/Ruleset.ts`): its 5th slot is `GitHub.Providers`, the
`ProviderCollection` tag `GitHub.providers()` outputs — never the raw `GitHubCredentials`
service its own provider handlers pull in via `octokitFor`. `RepositoryRuleset` now omits the
5th parameter, defaulting its declaration requirement to `Provider<RepositoryRuleset>` instead —
a real `ProviderServices` member, matching the pattern a standalone (non-collection) resource
needs.

Fixing only the declaration was not enough on its own: `GitHub.providers()` and
`RepositoryRulesetProvider()` written side by side as a stack's `providers` still fails to
typecheck, because `RepositoryRulesetProvider()`'s handlers need `GitHubCredentials` fed in, and
merging two layers does not thread one's output into the other's requirement. New export
`repoPolicyProviders()` (`repository-ruleset-providers.ts`) composes the two correctly —
`RepositoryRulesetProvider().pipe(Layer.provideMerge(GitHub.providers()))` merged with
`GitHub.providers()` itself — and is now the documented wiring in `docs/repo-policy.md`,
`docs/repository-ruleset.md`, `repo-policy.ts` and `declare-repo-baseline.ts`.

Added a type-level test (`repo-policy-stack.test.ts`): a real `Alchemy.Stack(...)` whose body
calls `declareRepoPolicy` and `declareRepoBaseline` with `repoPolicyProviders()`, built (never
run) so `tsc` checks it on every `bun run check` — the test that would have caught this before
it reached a consumer's bump PR.

No runtime behavior changes: every CRUD handler (`read`/`diff`/`reconcile`/`delete`) and its own
`GitHubCredentials` requirement is unchanged — only the type surface a stack body sees when
declaring the resource, and how the two providers compose, is fixed.
