# PostgreSQL grants — `@homeflare/alchemy/postgres` `Postgres.Grants`

One declarative grant set: one role, one schema, in one database of a cluster you run
yourself. Schema `USAGE`/`CREATE`, per-table privileges, per-column privileges, default
privileges for future tables per creator role, and an optional clear of PUBLIC — nothing
else. Walked against PostgreSQL 18.6 (`REL_18_6`, commit `724edf9b`); every vocabulary
and statement shape is pinned by committed fixtures in
`src/postgres/fixtures/` (`grants-provenance.test.ts`, `grants-acl.test.ts`).

## Why the kit builds this

The seat-wiring spec (landscape `docs/plans/2026-09-29-seat-wiring-spec.md`, B12) needs
one resource that states, in one place, what a seat's group role may do in Postgres —
today that is `bash` run by hand, unversioned and unreviewable. Upstream
`alchemy@2.0.0-beta.79` has no self-hosted Postgres grant resource (only vendor-API
Postgres), and no `@distilled.cloud/postgres` package exists (registry 404, checked
2026-09-23). This family rides the same runner transport `Postgres.Database` shipped
in kit#324: same `withPg` pooled socket path, same `postgresRunnerProviders` psql
transport — only the statements differ.

## Scope

`Postgres.Grants` writes ACL rows and nothing else. What that means operationally:

- **Objects are containers that already exist.** The grantee role (and every
  default-privileges `forRole`) must be in `pg_roles`, and the schema in `pg_namespace`
  (`PostgresGrantsRoleMissing` / `PostgresGrantsSchemaMissing` otherwise). Roles come
  from the operator or a future role resource; this family creates nothing.
- **Only the three table-class vocabularies are expressible.** Schema grants are
  `USAGE`/`CREATE` (`ACL_ALL_RIGHTS_SCHEMA`), table grants the eight relation words
  (`ACL_ALL_RIGHTS_RELATION`), column grants the four words the synopsis' column form
  accepts. No role membership, no ownership, no `SUPERUSER`/`CREATEROLE`/`BYPASSRLS`, no
  sequence/function/database/type/schema-of-database grants — a word outside the
  vocabulary is refused at plan (`PostgresGrantsPrivilegeRefused`).
- **Objects the declared role OWNS are left alone.** An owner holds every privilege
  implicitly — the ACL rows are not what carries those rights — and the catalogs say
  who owns what (`pg_namespace.nspowner`, `pg_class.relowner`). The repair and the
  delete skip owned objects entirely (measured on PG 18.6: a `REVOKE ALL` on a table
  the declared role owns strips its recorded ACL entries to `{}` while the owner's
  rights continue, so repairing them would only churn rows the state can never
  converge on). The projection records the ownership facts (`schemaOwnedByRole`,
  `ownedTables`). This resource still cannot make anyone an owner.
- **The declared objects are the whole write surface.** Objects the declaration does
  not name are never granted to or revoked from — and removing an entry from the
  declaration is itself a drift: the reconcile revokes the removed names (where the
  catalogs still show the role's words) before running the new declaration's plan, so
  taking an entry away takes the privilege away. PUBLIC is only ever cleared, only
  when `revokeFromPublic: true`, and never re-granted.
- **The declaration's `database` must match the connection's.** Every statement runs in
  the connected database; a mismatch is refused (`PostgresGrantsDatabaseMismatch`)
  rather than silently granting in the wrong one.

## Words, marks and letters

A privilege is a lowercase word: `select`, `insert`, `update`, `delete`, `truncate`,
`references`, `trigger`, `maintain` (tables); `usage`, `create` (schemas); `select`,
`insert`, `update`, `references` (columns). A trailing `*` marks WITH GRANT OPTION for
that word — `select*` and `select` are different states, and the repair converges on the
declared one. The letters the server actually stores (`acl.h`'s `ACL_*_CHR` defines)
live only in code and tests: attributes record words, so a persisted state file reads as
what was declared. Case is meaningful in the letter map — `C` is CREATE (schemas), `c` is
CONNECT (databases, out of scope).

A declaration may not name the same table, column pair or `forRole` twice
(`PostgresGrantsDuplicateObject`), and every name must fit `NAMEDATALEN`'s 63 UTF-8
bytes (`PostgresGrantsNameRefused` — the server would truncate and only NOTICE).

## Convergence: diff against the catalogs

Live state is read through `aclexplode` — one row per granted privilege, PUBLIC at
grantee oid zero — never by parsing `aclitem` text (`func.sgml`, committed fixture).
Reconcile is read → plan → execute → re-read → re-plan; an empty second plan is the
proof the repair landed (`PostgresGrantsRepairRefused` carries the surviving statements
when it did not — typically a grant made by a third grantor, which only that grantor or
the object's owner can revoke).

- **Re-run with nothing changed writes nothing.** Every class whose live set already
  equals the declaration contributes no statement.
- **Drift is repaired per class:** `REVOKE ALL` (clears extras and grant options), then
  `GRANT` the declared words — split into one plain grant and one
  `WITH GRANT OPTION` grant when the declaration mixes the two, because one option
  clause would grant the option to every listed privilege.
- **A multi-word column grant repeats the synopsis per word:** `GRANT select ("col"),
update ("col")` — one trailing column list binds only to the privilege it follows
  (gram.y@REL_18_6), so `GRANT select, update ("col")` would be a table-level grant of
  every word but the last; each word carries its own list, which puts all of them on the
  column and nothing on the relation.
- **A table revoke re-grants the table's columns in the same pass:** the server's
  table-level `REVOKE ALL` also clears the grantee's column entries on the table (measured
  on PG 18.6) — every one of them, not only the columns the declaration names. So when a
  table's privileges change, the plan re-grants the declared columns after the revoke, and
  every column entry the declaration does NOT name is re-granted as it was read: a table
  repair never strips a grant the declaration never mentioned. One pass converges.
- **Default privileges are per creator role:** `ALTER DEFAULT PRIVILEGES FOR ROLE …
IN SCHEMA … GRANT … ON TABLES`, for future tables only (`defaclobjtype = 'r'`). A
  `forRole` is never inferred; every entry names the role whose future objects get the
  privileges.
- **PUBLIC clearing is one-directional:** `revokeFromPublic: true` adds
  `REVOKE ALL ON SCHEMA … FROM PUBLIC` and `REVOKE ALL ON ALL TABLES IN SCHEMA … FROM
PUBLIC` when live reads still show PUBLIC holding something. Live PUBLIC privileges
  with the flag off are never drift; the attributes record the one-directional fact
  (`publicSchemaRevoked`, `publicTablesRevoked`).
- **Statements run one command at a time** (`grants-ops.ts`): every `REVOKE`/`GRANT`
  is its own autocommitted command — the socket path's prepared-statement protocol
  cannot carry several commands in one call, and the runner transport is one `psql`
  process per statement — so nothing wraps a repair in `BEGIN…COMMIT` today. A live
  grantee therefore briefly holds nothing on an object between that object's
  `REVOKE ALL` and its `GRANT`, and a statement that fails mid-repair leaves the
  earlier revokes applied. Both are bounded by the convergence proof: the persisted
  declaration drives the next apply, which re-plans and heals; an atomic repair needs
  a batch or transaction path on the shared transport, which the family does not
  have yet.

The diff is offline against persisted attributes (no live connection at plan time),
so it answers `update` or `noop` and never previews live drift by itself; the exact
GRANT/REVOKE statements appear at apply, and `alchemy drift` is the path that
re-reads the live catalogs.

`read` answers `Unowned` (a grant set carries no ownership mark) — a stack declaring
already-live grants needs `adopt(true)`. Retargeting `role`, `database` or `schema` is
refused at plan (`PostgresGrantsRetargetRefused`): those three name what the grant set
is about, so a new target is a new logical id.

## Delete

`defaultRemovalPolicy` is `retain` — most grant sets manage adopted, already-live
grants, and a destroy is a deliberate act. A `delete` revokes exactly what the last
declaration named, via the same repair plan with every word list emptied: one
`REVOKE ALL` per named object where the catalogs still show the role's words, nothing
for PUBLIC, nothing for objects the declaration never named, nothing for objects the
declared role owns (an owner's implicit rights are not this resource's to revoke),
never `CASCADE` (a revoke whose grantee re-granted onward surfaces as the server's own
`2BP01`), and a missing grantee or schema means there is nothing left to revoke and
the delete is a no-op.

## The per-seat shape (the example this family exists for)

One seat, one group role, one schema it owns the keys to, and read-only sight of the
shared ledger. The write half is OWNERSHIP, not ACL rows: the operator creates the
schema (and its tables) with the seat as owner, so the seat holds `CREATE` on the
schema and every privilege on its own tables implicitly — this resource recognizes
the catalogs' ownership facts (`pg_namespace.nspowner`, `pg_class.relowner`), records
them in state (`schemaOwnedByRole`, `ownedTables`), and issues nothing for those
objects. What the seat needs ACL rows FOR is other people's objects:

```ts
import { PostgresGrants, postgresProviders } from '@homeflare/alchemy/postgres';

// …provide `postgresProviders(config)` alongside the stack's other providers.

// The seat's own schema: the declarations below state the intent, and ownership
// satisfies them — the repair and the delete skip the owned schema and `notes`
// entirely (measured on PG 18.6: a REVOKE on them would strip the recorded ACL
// entries to `{}` while the rights continue, converging on nothing). PUBLIC's
// defaults are PUBLIC's, so the clear still runs:
class SeatClaude2Own extends PostgresGrants('grants/seat-claude2-own', {
  role: 'seat_claude2', // NOLOGIN group role, membership owned by a human
  database: 'agents', // the CT100 agents database this grant set lives in
  schema: 'claude2', // the seat's OWN schema — ownership carries the rights
  schemaUsage: true,
  schemaCreate: true,
  tables: [{ table: 'notes', privileges: ['select', 'insert', 'update', 'delete'] }],
  revokeFromPublic: true, // nothing in the seat's schema is world-readable
}) {}

// Select-only sight of the shared ledger, granted where it lives (the `ledger` schema
// in the same database, FORCE RLS'd at the table — this resource only writes ACL rows):
class SeatClaude2LedgerRead extends PostgresGrants('grants/seat-claude2-ledger-read', {
  role: 'seat_claude2',
  database: 'agents',
  schema: 'ledger',
  schemaUsage: true,
  schemaCreate: false,
  tables: [{ table: 'events', privileges: ['select'] }],
  revokeFromPublic: false, // PUBLIC's ledger defaults are the ledger stack's call
}) {}
```

The seat group role can write its own `claude2` schema (it owns the schema and its
tables — `SeatClaude2Own` records that in state) and only SELECT from the shared
ledger view. Column-level grants work the same way when a role must see one column of
a wide table — the estate read role `hf_agent`'s column-level SELECT on
`LiteLLM_SpendLogs` is the estate's own example.

## Not covered

Sequences, functions, databases, large objects and types are out of scope by name
(each with its synopsis reason, asserted in `grants-provenance.test.ts`); `Postgres.Role`
and `Postgres.Schema` do not exist yet, so the grantee role and the schema must come
from the operator; RLS policies are table structure, not ACL rows, so they belong to the
schema/table family and to migrations — `FORCE RLS` is declared where the ledger table
is created, never here.
