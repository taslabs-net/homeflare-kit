# PostgreSQL grants — the per-seat worked example

<!-- Split out of `postgres-grants.md` (2026-09-30) so both pages stay under the
     200-line doc cap: that page keeps the semantics, this one keeps the example. -->

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
