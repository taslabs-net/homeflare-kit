---
'@homeflare/alchemy': minor
---

Create-and-assert a database on a self-hosted cluster: `Postgres.Database` in the new
`@homeflare/alchemy/postgres` subpath. Walked against PostgreSQL 18.6 (`REL_18_6`, commit
`724edf9b`) — upstream `alchemy@2.0.0-beta.79` has vendor-API Postgres resources (Planetscale,
Neon, Prisma, Fly, Railway) and a runtime binding over `@effect/sql-pg`, but nothing for a
database you run yourself, so this builds on that same `@effect/sql-pg` `PgClient` upstream's
own `alchemy/SQL/Postgres` uses (new optional peer, `@effect/sql-pg@4.0.0-rc.115`).

Create-and-assert only: every optional prop (`encoding`, `localeProvider`, `lcCollate`,
`lcCtype`, `allowConnections`, `connectionLimit`, `isTemplate`, `tablespace`) is asserted once
at create and compared against the live row on every later plan — a mismatch is a typed
`PostgresDatabaseDrift` refusal, never an `ALTER DATABASE`. `name` is refused at plan past 63
UTF-8 bytes (`NAMEDATALEN`), because the server would otherwise silently truncate it with only
a `NOTICE`. A rename is refused at plan; `diff` never answers `replace` (a replace here is DROP
then CREATE, on data). `delete` always refuses with a typed tag and `defaultRemovalPolicy` is
`retain` — dropping a database stays a human act on the host. `CREATE DATABASE` takes no bind
parameters at all (measured at `gram.y`), so every value is quoted by hand: a single-token
identifier quoter for the name (deliberately NOT `alchemy`'s own `sql(value)`, which
dot-splits a qualified name and would break on a name containing `.`), and a string-literal
quoter for the rest. `read` always answers `Unowned` for a match — a database carries no
ownership mark, so an adopting stack needs `adopt(true)`.

Measured path (2026-09-23): only a Unix socket reaches the maintenance database on the mini —
no `pg_hba` rule opens it over TCP. A JS client reaches that socket: `@effect/sql-pg` under
Bun, live-checked from scratch space, connected and read all 24 live databases.
