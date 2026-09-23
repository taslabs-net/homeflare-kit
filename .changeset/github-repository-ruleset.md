---
'@homeflare/alchemy': minor
---

Add `GitHub.RepositoryRuleset`, a bridge resource under `@homeflare/alchemy/github` that
probes for an existing same-named ruleset by name before creating one (closing the
duplicate-ruleset hazard in upstream `alchemy@2.0.0-beta.79`'s `GitHub.Ruleset`) and
normalizes before comparing so a matching live ruleset is a true noop. Also adds
`declareRepoBaseline`, and rewires `declareRepoPolicy`'s ruleset half onto the new
resource — `builds` is the only caller, and its ruleset has never been created, so this
changes no live resource's identity.

Versions this was walked against: `alchemy@2.0.0-beta.79`, `@octokit/rest@22.0.1`,
`@octokit/openapi-types@27.0.0` (the version the REST method parameter types actually
resolve through — see `repository-ruleset-constraints.ts` for the version-chain note).
