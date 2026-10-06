# PostgreSQL — `Postgres.Schema`

One schema inside a self-hosted PostgreSQL 18 cluster: create-and-assert over `pg_namespace`,
walked against the same `REL_18_6` tree as `Postgres.Database` (see [postgres.md](./postgres.md)
for the measured path and quoting rules). This is the first seat-wiring resource for the CT100
`agents` database: each seat's group role owns a `<seat>` schema, and the shared `ledger.events`
lives under FORCE RLS (spec §5).

## The locked shape

Create-and-assert only. Plain `CREATE SCHEMA` is the only create this family issues.
There is no `ALTER SCHEMA` of any kind: Postgres's `ALTER SCHEMA` only renames or changes the
owner, and neither is implemented — a name change is refused at plan and apply
(`PostgresSchemaRenameRefused`), a `database` change is refused the same way
(`PostgresSchemaDatabaseRefused`), and an owner or comment mismatch against the live row is a
typed `PostgresSchemaDrift` refusal, the same rule `Postgres.Database` applies to its asserted
props.

## Props and mapping

| prop       | `CREATE SCHEMA` / statement                    | live source                            |
| ---------- | ---------------------------------------------- | -------------------------------------- |
| `name`     | the schema name (single `ColId`, `quoteIdent`) | `pg_namespace.nspname`                 |
| `database` | which database the handlers open               | `SELECT current_database()`            |
| `owner`    | `AUTHORIZATION` clause                         | `pg_get_userbyid(nspowner)`            |
| `comment`  | `COMMENT ON SCHEMA … IS`                       | `obj_description(oid, 'pg_namespace')` |

`owner` and `comment` are the only asserted props; both are compared against the live row on
every plan. `owner` must already exist as a role — checked with a `pg_roles` lookup before the
`CREATE SCHEMA`, so a missing role fails with `PostgresSchemaOwnerMissing` before any write.
An omitted `owner` is not "leave the live owner alone": a fresh `CREATE SCHEMA` without
`AUTHORIZATION` is owned by `current_user`, so the re-read compares `live.owner` to that role
and drifts on a mismatch. A concurrent creator is refused with
`PostgresSchemaExistsRefused` even when its owner matches; no comment is written.

## `database` (required)

The schema lives in one database of the cluster, and the resource is pinned to it. The family
connection points at a maintenance database — a brand-new database cannot be connected to on a
cold plan ([postgres.md](./postgres.md), measured path) — so the handlers open
`props.database` themselves: the runner transport swaps the `psql -d` target, the socket
transport swaps the pool's `database`. The swap is proven, never trusted: every read row
carries `current_database()`, `reconcile` and `delete` compare it against the declaration
before any write, and a mismatch fails with `PostgresSchemaWrongDatabase` — so a seat schema
meant for `agents` can never be created, read or dropped in the maintenance database by a
mis-wired connection. `read` refuses with the same tag when the row's own database differs.

A change of `database` is refused at plan and apply (`PostgresSchemaDatabaseRefused`): a schema is not
moved between databases — declare a new resource instead. A schema's `database` must be the
database it lives in, but on a cold plan that database may not exist yet. Pass it as an Output:
`Postgres.Schema({ database: db.name, ... })` where `db` is the `Postgres.Database` resource.
An unresolved Output makes a cold plan skip `read`'s live probe and plan a create, and Alchemy
orders the `Database` create before the `Schema` because the declaration references it.
Apply still checks for an existing schema: without persisted output it refuses with
`PostgresSchemaExistsRefused`, even if the owner matches (including `public`). Re-plan with
`--adopt` / `adopt(true)` to adopt it explicitly. An interrupted create uses this same adoption
path; a matching owner is never proof that this stack created it. A
literal database name (`database: 'agents'`) is safe only when the database already exists:
`read` and `delete` treat a missing declared database as "schema absent" (they probe
`pg_database` over the family connection first, so the untyped connect never happens), but
`reconcile` still requires it to exist.

## `name`

At most 63 UTF-8 bytes (`NAMEDATALEN`), refused at plan with `PostgresSchemaNameRefused` —
exactly the `nameByteRefusal` rule `Postgres.Database` uses, because the server would silently
truncate past it (same `truncate_identifier` in `scansup.c`) and a later read would never find
the schema again.

## `comment`

An empty string IS "no comment": Postgres stores `COMMENT ON SCHEMA … IS ''` as NULL, so
`comment: ''` is normalized to "no comment" — no `COMMENT ON` is issued, and the declaration
never drifts against the NULL the server stores. A comment mismatch is a drift refusal, and an
undeclared comment leaves an existing live comment alone (the declaration asserts what it
declares, nothing more). `COMMENT ON` is issued only after the re-read's owner has been
asserted. A race winner is refused first, so their schema is never commented: the kit role is
superuser, the comment would land, and the drift failure does not roll it back.

## `delete` — drop only what it can prove it created

Unlike `Postgres.Database` (which never drops), a schema can be dropped — but only when it is
empty, or when `cascade: true` is declared.

- Delete re-reads `pg_namespace` before any `DROP`. The engine does not re-read before a delete
  that has state (alchemy `Apply.ts`), so `delete` receives the last asserted `oid` + `owner`
  and nothing fresh. The handler matches the live row against that persisted proof: an absent
  schema is idempotent success, and a live row whose `oid` or `owner` no longer matches fails
  with `PostgresSchemaDeleteForeignRefused` — no `DROP` is issued, `CASCADE` included. This is
  the guard for a schema dropped out of band and recreated under the same name by another
  role, whose objects must survive the delete.
- `cascade` defaults to `false`, so `DROP SCHEMA` refuses a non-empty schema with
  `PostgresSchemaDropNotEmptyError`. The emptiness check is one `SELECT` over four catalogs —
  `pg_class` (relations), `pg_proc` (functions), `pg_type` (types/enums/domains) and
  `pg_operator` — so a schema holding only functions or enums is still refused. Whatever the
  catalogs miss is still safe: the server's own `2BP01` dependent-objects refusal is classified
  as the same typed tag. `2BP01` is class `2B`, so both transports wrap it as `UnknownError`
  with the raw code on `reason.cause.code` — the classifier reads that code, not the tag.
- With `cascade: true` the drop is `DROP SCHEMA IF EXISTS … CASCADE` and removes the schema's
  objects too — and, because Postgres cascades through `pg_depend`, anything in ANOTHER schema
  that depends on them (a view, a foreign key, a trigger another stack owns). So before a
  cascade drop the atomic block counts those dependents and refuses with
  `PostgresSchemaCascadeCrossSchemaRefused`, naming the COUNT only (never another owner's
  object names). A dependent whose catalog class is not recognised counts as foreign: the check
  fails closed. The `IF EXISTS` makes delete idempotent.
- The proof and the drop are ONE statement. The re-read, the emptiness (or dependents) check and
  the `DROP` run in a single `DO` block, so on the runner transport it is one `psql`. The block
  takes `pg_advisory_xact_lock(<schema oid>)`, re-verifies the persisted `oid` + `owner` inside
  the transaction, and only then drops; a schema replaced after the read is
  `PostgresSchemaDeleteForeignRefused`. The lock is cooperative (it serialises two runs of this
  provider, not an arbitrary `CREATE TABLE`); a creator that slips in after the check is still
  caught by the server's own `2BP01` on a plain drop.
- Every session pins `search_path = pg_catalog, pg_temp` (`search-path.ts`) and every SQL
  builder writes `pg_catalog.<name>`, so a role that can create objects in a schema on its
  path cannot forge `pg_namespace` and fake the delete proof. Runner path: the script is
  prefixed with the `SET`; socket path: the one reserved connection an operation uses is pinned
  first (`search-path.test.ts` greps the builders for an unqualified catalog name).
- A `cascade` change is a real change: it answers `update` (compared against the previous
  declaration's persisted props), so the flipped value reaches state and the eventual drop
  uses it — a schema first declared `cascade: true` stops dropping with CASCADE once the
  declaration says false.
- The `retain` default means `RemovalPolicy.destroy()` is required before any delete runs — the
  same two-layer guard the database family documents.

## Behaviour

| Concern     | Rule                                                                                                                                                                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity    | `name` is the logical id. A changed `name` or `database` is refused at plan and apply (never `ALTER … RENAME`, never a silent move).                                                                                                                                                                       |
| Adopt       | A schema carries no ownership mark (H1), so `read` answers `Unowned` for a match and an already-live schema needs `adopt(true)`. Apply without output refuses takeover.                                                                                                                                    |
| Removal     | `defaultRemovalPolicy: 'retain'`; opt in with `RemovalPolicy.destroy()`. Delete re-reads before any `DROP`: absent is idempotent, and a live row whose `oid` or `owner` fails the persisted proof refuses the delete with `PostgresSchemaDeleteForeignRefused`. Drop refuses non-empty without `cascade`.  |
| Read        | One bound `SELECT` on `pg_namespace` (name, owner, comment, `oid`, `current_database() AS database`). `undefined` when absent — and a declared database missing from `pg_database`, probed over the family connection first, counts as absent.                                                             |
| Write check | Re-reads after `CREATE` (S10): a schema still absent after a successful create fails with `PostgresSchemaCreateVanished`; every re-read row is asserted against the declaration (an omitted `owner` against `current_user`), a duplicate CREATE (42P06) is a typed adoption refusal before any COMMENT ON. |

## Not alterable, not modelled

`ALTER SCHEMA`'s two operations — rename and owner change — are deliberately absent (see above).
No other `pg_namespace` property (`nspacl` access-control list) is asserted: grants are a separate
seat resource (`Postgres.Grants`), not part of `Postgres.Schema`. The schema's `oid` is read back
for provenance, never declared. Read and reconcile compare the live oid to persisted output
and fail with `PostgresSchemaIdentityRefused` if the name was recycled out of band. Reconcile
cannot refresh away the proof that delete relies on; the oid and asserted owner persist for
that later comparison.

## PostgreSQL 18 semantics checked

- [CREATE SCHEMA](https://www.postgresql.org/docs/18/sql-createschema.html): `IF NOT EXISTS`
  does nothing even with a different owner. The provider deliberately uses plain CREATE;
  [REL_18_6 pg_namespace.c](https://github.com/postgres/postgres/blob/REL_18_6/src/backend/catalog/pg_namespace.c)
  raises `duplicate_schema` (42P06) for an existing name.
- [DROP SCHEMA](https://www.postgresql.org/docs/18/sql-dropschema.html): RESTRICT is the default;
  nonempty schemas require CASCADE. The fake preserves this refusal and seeds `public`.
- [Escape strings](https://www.postgresql.org/docs/18/sql-syntax-lexical.html#SQL-SYNTAX-STRINGS-ESCAPE):
  comments and all shared literal callers emit `E'…'`, doubling backslashes and quotes, under
  either `standard_conforming_strings` setting. Database options, Role literals, and the psql
  executor's inlined parameters use the same escaper; Grants uses it through that executor.
