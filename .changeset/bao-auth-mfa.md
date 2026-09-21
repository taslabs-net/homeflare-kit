---
'@homeflare/alchemy': minor
---

Add to `@homeflare/alchemy/openbao`:

- **`BaoJwtRole`**: roles on `jwt` and `oidc` mounts.
- **`BaoKubernetesRole`**: roles on `kubernetes` mounts.
- **`BaoJwtAuthConfig`**: the non-secret config of a JWT-validating mount. It deliberately has no OIDC client secret, and it refuses a mount that has one, because its full-replace write would erase it.
- **`BaoMfaTotpMethod`** and **`BaoMfaLoginEnforcement`**: login MFA. A TOTP method is found by name. Renaming one is refused, because a rename would strand every enrolled secret. Deleting an enforcement is refused, because in OpenBao 2.6.2 the delete comes back after a restart (openbao/openbao#4030).
- **`assertBaoIdentity`** (with `assertBaoIdentityEffect` and `BaoIdentityError`): refuses to proceed unless unauthenticated `sys/health` reports the expected `cluster_name` and the namespace is the expected one.
- **`hostAppRoles`**: a pure generator that makes one AppRole per host, named `<class>--<host>`. It refuses a secret_id TTL of 0.

Behaviour changes:

- A changed `path` on `BaoMount` or `BaoAuthMethod` now **fails the plan** unless the new `remountFrom` prop names the old path. With `remountFrom`, the mount is moved with `sys/remount`, keeping its data (leases under it are revoked). Before, the plan answered `update` and enabled an empty mount at the new path.
- A changed `name` on `BaoAuthRole`, or a changed `name` on `BaoPkiRole`, now plans `replace`. Before, it answered `update` and left the old role live with no state record.
- `BaoPkiRole` now manages `requireCn`, `enforceHostnames`, `keyUsage`, `allowedDomainsTemplate`, `noStore` and `generateLease`, defaulting to OpenBao's own values. Its full-replace write already reset these fields silently, so a role whose live values differ from those defaults now plans `update` instead of being reset unseen. `noStore` together with `generateLease` is refused.

See `src/openbao/REPLACE.md` for what every family does on a rename.
