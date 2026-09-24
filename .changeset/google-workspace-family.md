---
'@homeflare/alchemy': minor
---

Add the Google Workspace provider family (`@homeflare/alchemy/google-workspace`): `Group`,
`GroupMember`, `DomainAlias` and `OrgUnit` over the Admin SDK Directory API, built on
`@distilled.cloud/google-workspace@1.0.0-rc.12`'s typed `admin_directory_v1` operations
(S23 — no hand-rolled client). Adopt-first by get-by-key, `retain` on removal for everything
but membership, and no `User` resource (Google's own `User` schema carries a `password` field).
Credential setup — domain-wide delegation, the least OAuth scopes each resource needs, and
where the service-account key lives in OpenBao — is in
`packages/alchemy/docs/google-workspace.md`.
