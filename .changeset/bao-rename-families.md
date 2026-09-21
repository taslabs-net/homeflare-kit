---
'@homeflare/alchemy': minor
---

Rename safety for the other nine name- or catalog-keyed families in `@homeflare/alchemy/openbao`: `BaoAuthRole`, `BaoPkiRole`, `BaoJwtRole`, `BaoKubernetesRole`, `BaoJwtAuthConfig`, `BaoMfaTotpMethod`, `BaoMfaLoginEnforcement`, `BaoSshRole` and `BaoPlugin`. They now get the same checks as `BaoPolicy`, `BaoCloudflareRole` and `BaoProxmoxRole`, through one shared helper.

Behaviour changes:

- A rename or move onto a name, path or catalog entry that already exists now fails the plan, before anything is written. Before, two roles that swapped names under `RemovalPolicy.destroy()` both planned `replace`, and a green deploy deleted both of them. This happened for `BaoAuthRole`, `BaoPkiRole`, `BaoJwtRole`, `BaoKubernetesRole`, `BaoSshRole` and `BaoPlugin`. It also applies under `retain`: a swap now takes two deploys through a free name. For `BaoPlugin` it includes a version bump onto a version already registered by hand. For `BaoJwtAuthConfig` it includes a move onto a mount whose config is already set.
- The name or mount is now checked while other props are still pending Outputs. Before, a rename in the same deploy as any pending Output planned `update`, and the old object stayed live with no state record. For `BaoMfaTotpMethod` that wrote a second method. Its rename is now refused at plan in that case too.
- When the name itself is an Output not known until apply, reconcile now refuses the `update` before writing anything. The next deploy plans `replace`, or, for `BaoMfaTotpMethod`, refuses the rename.
- `BaoKubernetesRole` and `BaoJwtRole` compare names lowercased, as OpenBao keys them, so a change of case is not a move. Both still refuse an upper-case name.
- `hostAppRoles` now lets a host sit in several classes, with one role per class. It only refuses the same host listed twice in one class. Before, any host listed twice was refused.
- `hostAppRoles` refuses a host whose class names an inherited object key such as `constructor`. Before, that host passed as a class with no policies and no `secretIdTtl`, and got a role whose secret_id never expires.

Documentation: a new logical id for a name that is already live adopts it, and under `RemovalPolicy.destroy()` the old id's delete then removes it, in a green deploy. Change a logical id with Alchemy's `renamedFrom`, and take a name another resource is leaving in the deploy after the move (REPLACE.md). Also: deleting an AppRole role does not revoke the tokens it issued. OpenBao 2.6.2 deletes the role's secret_ids and role_id, so no new login succeeds, but issued tokens live to their TTL and only fail to renew. The `BaoAuthRole` comments said the delete revoked every token.
