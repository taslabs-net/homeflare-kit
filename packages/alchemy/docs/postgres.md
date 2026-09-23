# PostgreSQL — `@homeflare/alchemy/postgres`

`Postgres.Database`: create-and-assert over a self-hosted cluster, walked against PostgreSQL
18.6 (`REL_18_6`, commit `724edf9b`). It retires `org.nixos.postgres-reconcile`, a 38-line bash
loop over 19 databases run against the trust socket.

## Why the kit builds this instead of using upstream

Upstream `alchemy@2.0.0-beta.79` has no resource for a database in a self-hosted cluster —
measured against `v2.0.0-beta.79`'s full tree: it ships vendor-API Postgres resources
(`Planetscale.Postgres.*`, `Neon.PostgresOrigin`, `Prisma.Postgres`, `Fly.Postgres`,
`Railway.Postgres`) and the runtime binding `alchemy/SQL/Postgres` over `@effect/sql-pg`, but
nothing that issues `CREATE DATABASE` against a cluster you run yourself. No
`@distilled.cloud/postgres` or `@distilled.cloud/postgresql` package exists either (registry
404, checked 2026-09-23). This family builds on the same `@effect/sql-pg` `PgClient` upstream's
own binding uses, so it stays host-independent and portable — CT100's own Postgres (vault
decision 21) can use it later, and it is shaped to upstream.

## The locked shape

Create-and-assert only. `delete` always refuses. There is no `ALTER OWNER` and no `ALTER
DATABASE` of any kind. There is no password prop — a database carries none in `pg_database`.

## Measured path (2026-09-23)

Read `pg_hba_file_rules` and `pg_settings` over the trust socket: `listen_addresses` is
`10.100.1.1`, `ssl` is `on` (min `TLSv1.2`), and the `hostssl` rules cover only `netbox`,
`discord`, `litellm`, `teslamate` and one `homeflare-*` app group — **no TCP rule reaches the
`postgres` maintenance database.** Line 1 of `pg_hba_file_rules` is `local all all trust`. So
today only a stack that deploys on the mini, over the Unix socket at
`/opt/homeflare/postgres/sockets` (mode `0755`, owner `tim`), can create a database.

**A JS client reaches that socket.** Measured live with `@effect/sql-pg@4.0.0-rc.115` under
Bun, from scratch space, never committed: `PgClient.layer({ host:
'/opt/homeflare/postgres/sockets', port: 5432, database: 'postgres', username: 'tim' })`
connects and `SELECT version()` answers `PostgreSQL 18.6 on aarch64-apple-darwin25.6.0…`. The
catalog SELECT this family issues answered all 24 live non-template databases. `SHOW
standard_conforming_strings` is `on` — the assumption `quoteStringLiteral` (`database-sql.ts`)
rests on.

The reconciler being retired, `/nix/store/…-postgres-reconcile.sh`, runs `psql -h
/opt/homeflare/postgres/sockets -U tim -d postgres`; for each of 19 databases it runs `CREATE
DATABASE "$db" OWNER tim` when missing and asserts `pg_get_userbyid(datdba) = tim`. It never
drops anything.

## `name`

At most 63 UTF-8 bytes (`NAMEDATALEN` 64, `pg_config_manual.h` line 29), refused at plan.
Measured at `scansup.c`'s `truncate_identifier`: past that length the server clips the name with
`pg_mbcliplen` (byte-oriented, multibyte-aware) and raises only a `NOTICE`
(`ERRCODE_NAME_TOO_LONG`) — never an error. A create would silently succeed against the
truncated name, and the next plan's `WHERE datname = $1` (the name exactly as declared) would
find nothing and try to create it again, forever. Refusing at plan is the only way this stays a
one-time failure instead of an infinite loop.

## Mapping (`database-provenance.test.ts` proves this against the committed fixtures)

| prop               | `CREATE DATABASE` option | `pg_database` column                                |
| ------------------ | ------------------------ | --------------------------------------------------- |
| `owner`            | `OWNER`                  | `datdba` (via `pg_get_userbyid`)                    |
| `encoding`         | `ENCODING`               | `encoding`                                          |
| `localeProvider`   | `LOCALE_PROVIDER`        | `datlocprovider`                                    |
| `lcCollate`        | `LC_COLLATE`             | `datcollate`                                        |
| `lcCtype`          | `LC_CTYPE`               | `datctype`                                          |
| `allowConnections` | `ALLOW_CONNECTIONS`      | `datallowconn`                                      |
| `connectionLimit`  | `CONNECTION LIMIT`       | `datconnlimit`                                      |
| `isTemplate`       | `IS_TEMPLATE`            | `datistemplate`                                     |
| `tablespace`       | `TABLESPACE`             | `dattablespace` (joined to `pg_tablespace.spcname`) |

`datlocprovider` is Postgres's internal 1-byte `"char"` type. Measured live: `@effect/sql-pg`
decodes it as raw bytes, not text, so the read query maps it with a `CASE` in SQL to the same
three words `pg_collation.h`'s `collprovider_name` returns for the same codes (`b`→`builtin`,
`i`→`icu`, `c`→`libc`) before it ever crosses the wire as JSON.

### Excluded, and why

| option              | reason                                                                       |
| ------------------- | ---------------------------------------------------------------------------- |
| `TEMPLATE`          | consumed only at create time to copy from; no column records it              |
| `STRATEGY`          | consumed only at create time (WAL_LOG/FILE_COPY); not stored                 |
| `LOCALE`            | a shorthand for `LC_COLLATE`/`LC_CTYPE`; this family declares those directly |
| `BUILTIN_LOCALE`    | folds into `datcollate`/`datctype` like `LOCALE`, no column of its own       |
| `ICU_LOCALE`        | `datlocale` exists, but deferred — all 24 live databases are libc            |
| `ICU_RULES`         | stored in `daticurules`, no ICU-provider consumer yet                        |
| `COLLATION_VERSION` | for `pg_upgrade`; normally omitted so Postgres computes it                   |
| `OID`               | for `pg_upgrade`'s internal use only; not something a stack should assert    |

## Identifier quoting: why this file does not reuse `alchemy`'s `sql(value)`

`CREATE DATABASE` takes no bind parameters for any value, not even `OWNER` — measured at
`gram.y`: every `createdb_opt_item` value is `NumericOnly`, `opt_boolean_or_string` or the
keyword `DEFAULT`, none of which reaches `PARAM` (`$n`). Every value in this statement is
escaped by hand and run through `.unsafe()`.

The database `name` is a `ColId` (`gram.y` line 17327) — one token. Effect's own
`Statement.defaultEscape('"')`, what `sql(value)` compiles to, ALSO rewrites every `.` in a
value to `"."`, because it is built for a schema-qualified name like `schema.table`. A database
named `"my.app"` would come out `"my"."app"` — two tokens where the grammar parses one, a
syntax error this provider would cause. `quoteIdent` (`database-sql.ts`) is the single-token
form instead: quote, and double an embedded `"`. Nothing else.

Every other `WITH` value (`OWNER`, `TABLESPACE`, `ENCODING`, `LOCALE_PROVIDER`, `LC_COLLATE`,
`LC_CTYPE`) is a string literal in the grammar, not an identifier: `createdb_opt_item`'s
string branch is `opt_boolean_or_string → NonReservedWord_or_Sconst → NonReservedWord |
Sconst`. `quoteStringLiteral` wraps in `'` and doubles an embedded `'`; it never emits a
backslash, so it does not depend on which way `standard_conforming_strings` points (measured
`on` above, the PG18 default since 9.1).

## House differences from S11/S14

`delete` refuses unconditionally (`PostgresDatabaseDropRefused`) and `defaultRemovalPolicy` is
`retain` — two independent reasons `DROP DATABASE` never runs through this provider. Most
databases this family will manage are adopted, not created from nothing; a destroy on data is
Tim's manual act over the socket, never an engine call.

## Ownership

A database carries no ownership mark in `pg_database`. Per H1 (the house's Snippet-precedent
rule for marker-less APIs), `read` always answers `Unowned` for a match — every one of the
mini's 19 already-live databases needs `adopt(true)` in the consuming stack.

## Unmeasured

Whether `ALTER DATABASE … REFRESH COLLATION VERSION` should ever be offered as an explicit,
separate operation (not part of `reconcile`) is open — nothing in this family calls it.
