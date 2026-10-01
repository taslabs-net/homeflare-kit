---
'@homeflare/alchemy': minor
---

Add `Valkey.Instance` and `Valkey.AclFile` (`@homeflare/alchemy/valkey`): assert-and-read a running Valkey server (`INFO`/`CONFIG GET`, drift refused, delete never stops it) and declare each instance's ACL users with key-prefix scopes and fixed command profiles, passwords by `{ fromEnv }` reference (state stores a scrypt seal, never the value). A seat `keyPrefix` other than `<name>:*` is refused before any write. The socket has a deadline and a reply-length cap; a peer reset returns `ValkeySocketError` instead of exiting the process. Hand-rolled RESP over `node:net`; no `@distilled.cloud/valkey` exists.

Round-3 hardening: `Valkey.AclFile` supports kit-owned instances without `--aclfile` only.
Configured ACL files are refused on reconcile/delete, including adoption's forced reconcile;
CT100's ACLs remain owned by `homeflare-ct100` templates and its users cannot run `ACL LIST`.
Management is runtime-only and must be reapplied after restart. Ordinary plan diff compares
stored attributes; `alchemy drift` re-reads live state.

Keep connections available to lifecycle handlers with `Layer.provideMerge` and route each
resource through its named instance connection (`valkeyProviders` now requires `instance`).
Missing names fail with `ValkeyConnectionMissing`; combined providers cannot redirect seat
users to a different named instance. Track managed usernames separately from observed users:
removing a declared seat plans an update and revokes it, while never-managed users survive
unless `exclusive: true`. Map ACL socket acquisition and operation failures to the typed
`ValkeyInstanceUnreachable`; authentication failures retain their own typed errors.

Also add ct100#117's key-less monitor profile, scope service channels, and send SHA-256
password tokens. The bounded RESP implementation's exception to beta.79 Redis reuse is
source-audited and tested. Valkey 8.1.10/9.1.1 remain the vendor versions walked against;
no live estate instance was accessed.
