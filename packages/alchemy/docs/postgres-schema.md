# PostgreSQL — `Postgres.Schema`

One schema inside a self-hosted PostgreSQL 18 cluster: create-and-assert over `pg_namespace`,
walked against the same `REL_18_6` tree as `Postgres.Database` (see [postgres.md](./postgres.md)
for the measured path and quoting rules). This is the first seat-wiring resource for the CT100
`agents` database: each seat's group role owns a `<seat>` schema, and the shared `ledger.events`
lives under FORCE RLS (spec §5).

## The locked shape

Create-and-assert only. `CREATE SCHEMA IF NOT EXISTS` is the only create this family issues.
There is no `ALTER SCHEMA` of any kind: Postgres's `ALTER SCHEMA` only renames or changes the
owner, and neither is implemented — a name change is refused at plan
(`PostgresSchemaRenameRefused`) and an owner or comment mismatch against the live row is a typed
`PostgresSchemaDrift` refusal, the same rule `Postgres.Database` applies to its asserted props.

## Props and mapping

| prop      | `CREATE SCHEMA` / statement                    | live source                            |
| --------- | ---------------------------------------------- | -------------------------------------- |
| `name`    | the schema name (single `ColId`, `quoteIdent`) | `pg_namespace.nspname`                 |
| `owner`   | `AUTHORIZATION` clause                         | `pg_get_userbyid(nspowner)`            |
| `comment` | `COMMENT ON SCHEMA … IS`                       | `obj_description(oid, 'pg_namespace')` |

`owner` and `comment` are the only asserted props; both are compared against the live row on
every plan. `owner` must already exist as a role — checked with a `pg_roles` lookup before the
`CREATE SCHEMA`, so a missing role fails with `PostgresSchemaOwnerMissing` before any write.

## `name`

At most 63 UTF-8 bytes (`NAMEDATALEN`), refused at plan with `PostgresSchemaNameRefused` —
exactly the `nameByteRefusal` rule `Postgres.Database` uses, because the server would silently
truncate past it (same `truncate_identifier` in `scansup.c`) and a later read would never find
the schema again.

## `delete` — drop only when safe

Unlike `Postgres.Database` (which never drops), a schema can be dropped — but only when it is
empty, or when `cascade: true` is declared.

- `cascade` defaults to `false`, so `DROP SCHEMA` refuses a non-empty schema with
  `PostgresSchemaDropNotEmptyError`. The emptiness check is one `SELECT` over `pg_class` for
  relations whose `relnamespace` is the schema's `oid`.
- With `cascade: true` the drop is `DROP SCHEMA IF EXISTS … CASCADE` and removes the schema's
  objects too. The `IF EXISTS` makes delete idempotent.
- The `retain` default means `RemovalPolicy.destroy()` is required before any delete runs — the
  same two-layer guard the database family documents.

## Behaviour

| Concern     | Rule                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity    | `name` is the logical id. A changed name is refused at plan (never `ALTER … RENAME`).                                                                              |
| Adopt       | A schema carries no ownership mark (H1), so `read` answers `Unowned` for a match and an already-live schema needs `adopt(true)`.                                   |
| Removal     | `defaultRemovalPolicy: 'retain'`; opt in with `RemovalPolicy.destroy()`. Drop refuses non-empty without `cascade`.                                                 |
| Read        | One bound `SELECT` on `pg_namespace` (name, owner, comment, `oid`). `undefined` when absent.                                                                       |
| Write check | Re-reads after `CREATE` (S10): a schema still absent after a successful create fails with `PostgresSchemaCreateVanished`; a comment is re-read after `COMMENT ON`. |

## Not alterable, not modelled

`ALTER SCHEMA`'s two operations — rename and owner change — are deliberately absent (see above).
No other `pg_namespace` property (`nspacl` access-control list) is asserted: grants are a separate
seat resource (`Postgres.Grants`), not part of `Postgres.Schema`. The schema's `oid` is read back
for provenance but never declared or asserted.
