---
'@homeflare/alchemy': patch
---

Export `BaoCloudflareRole` and the Cloudflare role catalog helpers from `@homeflare/alchemy/openbao`, and retry dropped OpenBao transports.

Stacks declaring mint roles need the resource constructor plus `parseRolesConfig` / `expandAll` / `permissionGroupsFromEngine`. The barrel previously shipped only `BaoCloudflareRoleProvider`. A 585-role plan against a Mesh-fronted vault died mid-diff with an empty transport error; status-0 calls now retry twice.
