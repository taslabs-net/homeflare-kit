# `Postgres.Role` — `@homeflare/alchemy/postgres`: create / adopt / alter / drop of a LOGIN or NOLOGIN role on a self-hosted PostgreSQL 18.6 cluster, walked against `REL_18_6` (commit `724edf9b`).

## Why the kit builds this instead of using upstream

Upstream `alchemy@2.0.0-beta.79` ships no role resource for a self-hosted cluster. Its only
`PostgresRole` is `Planetscale/Postgres/PostgresRole.ts`, built on the `@distilled.cloud/planetscale`
SDK and its `Credentials` — a vendor-API row that cannot `CREATE ROLE` against the cluster you
run yourself. The `Postgres.Database` resource in this kit already binds `@effect/sql-pg`'s
`PgClient` over the same transports; `Postgres.Role` reuses that client and the runner
(`psql-executor.ts`), so it stays host-independent and portable to CT100's own Postgres.

## Locked shape

- **Alter-capable, unlike `Postgres.Database`.** `LOGIN`/`NOLOGIN`, `INHERIT`/`NOINHERIT`,
  `CONNECTION LIMIT`, and `VALID UNTIL` each have a safe atomic `ALTER ROLE` form, so a drifted
  live row is brought back to the declaration, never refused. A rename is still refused
  (`PostgresRoleRenameRefused`); `diff` answers `update` or `noop`, never `replace`.
- **The password is a reference, never a value.** Declared as `{ fromEnv: 'PG_SEAT_WIDGET_PASSWORD' }`.
  The variable name lands in state; the value is resolved from the deploying process's environment
  at reconcile time, held as `Redacted`, and quoted into the one `ALTER ROLE … PASSWORD` statement
  that needs it. State remembers only a `scrypt:<salt>:<digest>` seal, so a reconcile re-sends the
  secret only when the environment value differs from the one last written — a plan never re-sends
  a secret that already matches, and never stores one. A create that declares a password but whose
  variable is unset refuses before any write (`PostgresRolePasswordEnvUnsetError`).
- **Membership is `pg_auth_members`, compared as a sorted set.** `memberOf` omitted leaves live
  memberships alone; `[]` ensures none. Moves run through one-parent `GRANT`/`REVOKE`
  (`alter_role.sgml`: "there are no options for adding or removing memberships; use GRANT and
  REVOKE").
- **`defaultRemovalPolicy: 'retain'`.** A seat group role may own objects and be granted across
  databases. A destroy is still implemented in full (`DROP ROLE IF EXISTS`, idempotent), opted in
  with `.pipe(RemovalPolicy.destroy())`. A role that still owns objects fails the drop with the
  server's own `2B01`, surfaced as the client's `SqlError`.

## Props → `CREATE ROLE` / `ALTER ROLE` → catalog mapping

`role-provenance.test.ts` proves this against the committed fixtures
(`create_role.sgml`, `alter_role.sgml`, `pg_authid.h`, `pg_auth_members.h`).

| prop              | `CREATE ROLE` / `ALTER ROLE` option          | catalog column                       |
| ----------------- | -------------------------------------------- | ------------------------------------ |
| `name`            | role name (identifier)                       | `pg_roles.rolname`                   |
| `login`           | `LOGIN` / `NOLOGIN`                          | `pg_roles.rolcanlogin`               |
| `inherit`         | `INHERIT` / `NOINHERIT`                      | `pg_roles.rolinherit`                |
| `connectionLimit` | `CONNECTION LIMIT n` (`-1` unlimited)        | `pg_roles.rolconnlimit`              |
| `validUntil`      | `VALID UNTIL 'timestamp'`                    | `pg_roles.rolvaliduntil`             |
| `memberOf`        | `GRANT parent TO member`                     | `pg_auth_members.member` / `roleid`  |
| `password`        | `PASSWORD '…'` (via `ALTER ROLE`, reference) | `pg_authid.rolpassword` (never read) |

`login` and `inherit` are required: the resource configures a LOGIN or NOLOGIN role with INHERIT
explicit, per the seat-wiring spec's group-role-per-seat shape (NOLOGIN, member of `hf_agent`,
owning its own schema).

## Identifier quoting and literals

`CREATE ROLE`/`ALTER ROLE` take no bind parameters; every value is an inlined, hand-quoted
literal. The role `name` is a `ColId` (one token), so `quoteIdent` quotes and doubles an embedded
`"` — unlike `Effect`'s `sql(value)`, which would rewrite `"a.b"` into a two-token
schema-qualified name and produce a syntax error. `quoteStringLiteral` wraps in `'` and doubles an
embedded `'`, never emits a backslash.

## Plan-time refusals

- **Name over 63 UTF-8 bytes** (`PostgresRoleNameRefused`): `NAMEDATALEN` 64, so 63 bytes is the
  last name that survives whole. `truncate_identifier` clips at 63 bytes and emits only a NOTICE;
  a create would succeed against the truncated name and the next plan would look for the original
  name and find nothing, forever. Same hazard as `PostgresDatabaseNameRefused`.
- **Zone-free `validUntil`** (`PostgresRoleValidUntilRefused`): PostgreSQL reads `VALID UNTIL
'2027-01-01'` as midnight in the session's time zone; the deploying process parses the same
  string as UTC. The instants differ, so the value read back would never equal the declaration and
  every plan would re-issue the same `ALTER`. A string ECMAScript cannot parse reaches the same
  refusal; PostgreSQL would reject it too, only later and as an unclassified statement error.
  Declare an ISO 8601 string carrying `Z` (or a numeric offset).
- **Rename** (`PostgresRoleRenameRefused`): the declared name differs from the live row's name.

## Reading back (`S10`)

Every write is re-read. The seal is state-only (`pg_roles` answers no password), so the last
written seal rides back into the attributes the engine compares and stores, `diff` reads the
environment in-process and answers `update` when the resolved value no longer matches it, and
`reconcile` compares against that state seal — never against a cluster read. `validUntil` is
serialised server-side to `...Z`; comparison uses `Date.parse` on both sides, so millisecond
`.000Z` churn is equality, not drift. A create whose re-read answers `undefined` fails typed
(`PostgresRoleCreateVanished`).

## Providers

- `postgresRoleProviders({ host, database, username })` — the socket transport, same cluster
  parameter shape as `postgresProviders`. The cluster is a parameter, never a default.
- `postgresRoleRunnerProviders({ run, database, username })` — the same reconcile over a
  caller-supplied `PsqlRunner` (loopback-only cluster, `ssh <host> sudo -n podman exec -i postgres
…`).
