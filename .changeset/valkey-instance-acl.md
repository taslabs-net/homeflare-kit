---
'@homeflare/alchemy': minor
---

Add `Valkey.Instance` and `Valkey.AclFile` (`@homeflare/alchemy/valkey`): assert-and-read a running Valkey server (`INFO`/`CONFIG GET`, drift refused, delete never stops it) and declare each instance's ACL users with key-prefix scopes and fixed command profiles, passwords by `{ fromEnv }` reference (state stores a scrypt seal, never the value). Hand-rolled RESP over `node:net`; no `@distilled.cloud/valkey` exists.
