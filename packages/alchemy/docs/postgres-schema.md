# PostgreSQL — `Postgres.Schema`

One schema inside a self-hosted PostgreSQL 18 cluster: create-and-assert over `pg_namespace`,
walked against the same `REL_18_6` tree as `Postgres.Database` (see [postgres.md](./postgres.md)
for the measured path and quoting rules). This is the first seat-wiring resource for the CT100
`agents` database: each seat's group role owns a `<seat>` schema, and the shared `ledger.events`
lives under FORCE RLS (spec §5).

## The locked shape

10Create-and-assert only. `CREATE SCHEMA IF NOT EXISTS` is the only create this family issues.
There is no `ALTER SCHEMA` of any kind: Postgres's `ALTER SCHEMA` only renames or changes the
owner, and neither is implemented — a name change is refused at plan
(`PostgresSchemaRenameRefused`), a `database` change is refused the same way
(`PostgresSchemaDatabaseRefused`), and an owner or comment mismatch against the live row is a
typed `PostgresSchemaDrift` refusal, the same rule `Postgres.Database` applies to its asserted
props.

## Props and mapping

20| prop | `CREATE SCHEMA` / statement | live source |
| ---------- | ---------------------------------------------- | --------------------------------------- |
| `name` | the schema name (single `ColId`, `quoteIdent`) | `pg_namespace.nspname` |
| `database` | which database the handlers open | `SELECT current_database()` |
| `owner` | `AUTHORIZATION` clause | `pg_get_userbyid(nspowner)` |
| `comment` | `COMMENT ON SCHEMA … IS` | `obj_description(oid, 'pg_namespace')` |

`owner` and `comment` are the only asserted props; both are compared against the live row on
every plan. `owner` must already exist as a role — checked with a `pg_roles` lookup before the
30`CREATE SCHEMA`, so a missing role fails with `PostgresSchemaOwnerMissing` before any write.

## `database` (required)

The schema lives in one database of the cluster, and the resource is pinned to it. The family
connection points at a maintenance database — a brand-new database cannot be connected to on a
cold plan ([postgres.md](./postgres.md), measured path) — so the handlers open
`props.database` themselves: the runner transport swaps the `psql -d` target, the socket
transport swaps the pool's `database`. The swap is proven, never trusted: every read row
carries `current_database()`, `reconcile` and `delete` compare it against the declaration
before any write, and a mismatch fails with `PostgresSchemaWrongDatabase` — so a seat schema
40meant for `agents` can never be created, read or dropped in the maintenance database by a
mis-wired connection. `read` refuses with the same tag when the row's own database differs.

A change of `database` is refused at plan (`PostgresSchemaDatabaseRefused`): a schema is not
moved between databases — declare a new resource instead. On a cold plan the declared database
must already exist: declare it with `Postgres.Database` and wire `dependsOn`, otherwise the
handlers cannot open it at all.

## `name`

At most 63 UTF-8 bytes (`NAMEDATALEN`), refused at plan with `PostgresSchemaNameRefused` —
exactly the `nameByteRefusal` rule `Postgres.Database` uses, because the server would silently
truncate past it (same `truncate_identifier` in `scansup.c`) and a later read would never find
50the schema again.

## `comment`

An empty string IS "no comment": Postgres stores `COMMENT ON SCHEMA … IS ''` as NULL, so
`comment: ''` is normalized to "no comment" — no `COMMENT ON` is issued, and the declaration
never drifts against the NULL the server stores. A comment mismatch is a drift refusal, and an
undeclared comment leaves an existing live comment alone (the declaration asserts what it
declares, nothing more).

## `delete` — drop only when safe

Unlike `Postgres.Database` (which never drops), a schema can be dropped — but only when it is
60empty, or when `cascade: true` is declared.

- `cascade` defaults to `false`, so `DROP SCHEMA` refuses a non-empty schema with
  `PostgresSchemaDropNotEmptyError`. The emptiness check is one `SELECT` over four catalogs —
  `pg_class` (relations), `pg_proc` (functions), `pg_type` (types/enums/domains) and
  `pg_operator` — so a schema holding only functions or enums is still refused. Whatever the
  catalogs miss is still safe: the server's own `2BP01` dependent-objects refusal is classified
  as the same typed tag.
- With `cascade: true` the drop is `DROP SCHEMA IF EXISTS … CASCADE` and removes the schema's
  objects too. The `IF EXISTS` makes delete idempotent.
- A `cascade` change is a real change: it answers `update` (compared against the previous
  declaration's persisted props), so the flipped value reaches state and the eventual drop
  uses it — a schema first declared `cascade: true` stops dropping with CASCADE once the
  declaration says false.
- The `retain` default means `RemovalPolicy.destroy()` is required before any delete runs — the
  same two-layer guard the database family documents.

## Behaviour

| Concern     | Rule                                                                                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity    | `name` is the logical id. A changed `name` or `database` is refused at plan (never `ALTER … RENAME`, never a silent move).                                                                                                                                                                  |
| Adopt       | A schema carries no ownership mark (H1), so `read` answers `Unowned` for a match and an already-live schema needs `adopt(true)`.                                                                                                                                                            |
| Removal     | `defaultRemovalPolicy: 'retain'`; opt in with `RemovalPolicy.destroy()`. Drop refuses non-empty without `cascade`.                                                                                                                                                                          |
| Read        | One bound `SELECT` on `pg_namespace` (name, owner, comment, `oid`, `current_database() AS database`). `undefined` when absent.                                                                                                                                                              |
| Write check | Re-reads after `CREATE` (S10): a schema still absent after a successful create fails with `PostgresSchemaCreateVanished`; every re-read row is asserted against the declaration, so a concurrent creator winning the `IF NOT EXISTS` race is a drift refusal, never a silently adopted row. |

## Not alterable, not modelled

`ALTER SCHEMA`'s two operations — rename and owner change — are deliberately absent (see above).
No other `pg_namespace` property (`nspacl` access-control list) is asserted: grants are a separate
seat resource (`Postgres.Grants`), not part of `Postgres.Schema`. The schema's `oid` is read back
for provenance but never declared or asserted.
