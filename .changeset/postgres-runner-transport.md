---
'@homeflare/alchemy': minor
---

`Postgres.Database` can now reach a loopback-only cluster through a caller-supplied command runner (`postgresRunnerProviders`), creating databases `FROM template0` by default on that transport.
