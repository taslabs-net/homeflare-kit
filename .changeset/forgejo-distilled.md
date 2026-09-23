---
'@homeflare/alchemy': patch
---

The `forgejo/*` family (`Forgejo.Repository`, `Forgejo.BranchProtection`,
`Forgejo.OrgLabel`, `Forgejo.OrgTeam`, `Forgejo.RepoWebhook`,
`Forgejo.OrgSecret`, `Forgejo.TeamMember`) now calls
`@distilled.cloud/forgejo@1.0.0-rc.12`'s typed operations instead of a
hand-rolled `Effect HttpClient` client — `catchTag('NotFound', …)` in place
of a status-carrying `ForgejoError`. `client.ts` is gone; nothing else in
this package imported it. Credentials still resolve from `FORGEJO_URL` /
`FORGEJO_TOKEN` at call time, now through the package's own
`CredentialsFromEnv` layer. Every operation this family calls exists in the
package and every error it handles carries a tag, so no distilled patch was
needed. Props and attributes are unchanged — an adopted repository, label,
team, webhook, branch protection rule, org secret or team membership still
plans noop.
