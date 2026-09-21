---
'@homeflare/alchemy': minor
---

Add `appRoleLogin` / `revokeSelf` (with `appRoleLoginEffect`, `revokeSelfEffect` and `BaoLoginError`) to `@homeflare/alchemy/openbao`, so wrapper scripts can log in with an AppRole and revoke on exit. They use the same address resolution and transport as the `Bao.*` families. The login never sends `BAO_TOKEN`, and error strings are redacted, because OpenBao 2.6.2 can echo a secret_id back in an error.

Add `BaoPlugin` / `BaoPluginProvider` for the plugin catalog (`sys/plugins/catalog/<type>/<name>`). It has no `env` prop and retains on destroy. It refuses to shadow a builtin or overwrite a declarative entry, and it names the fix when an unversioned registration is filed under the binary's self-reported version.

Fix `BaoSshRole` writes. `default_extensions` and `default_critical_options` were sent as JSON strings. OpenBao's field validation rejects that with a 400, so every role write failed. They are now sent as objects.
