/**
 * `Postgres.Database`'s failures as typed tags (S21).
 *
 * ⛔ NONE OF THESE IS A STATUS-CODE OR MESSAGE MATCH. Every one is raised by this family's own
 *   code from a fact it already checked (a byte count, a live catalog row, a role lookup) — never
 *   from sniffing a driver error's text. The one live-SQLSTATE check this family makes —
 *   `isDuplicateDatabaseRace` in `database-sql.ts`, for the `42P04` create race — reads the raw
 *   code `@effect/sql-pg` classified onto `SqlSyntaxError.cause.code` (measured in
 *   `node_modules/@effect/sql-pg/src/internal/sqlError.ts#classifySqlState`: every `42xxx` code,
 *   `42P04` included, becomes `SqlSyntaxError` — there is no more specific tag for it), and it
 *   never produces one of these tags: a race converges instead of failing.
 */
import * as Data from 'effect/Data';

/**
 * A declared name would be silently truncated by the server (`NAMEDATALEN` 64, so 63 UTF-8
 * bytes is the last one that survives whole) — refused at plan, before any statement runs.
 *
 * ⛔ WHY THIS IS A PLAN-TIME REFUSAL AND NOT A SERVER ERROR. `truncate_identifier`
 *   (`scansup.c@REL_18_6` line 93) clips a long name to 63 bytes and raises only a `NOTICE`
 *   (`errcode(ERRCODE_NAME_TOO_LONG)`), never an error. A create would succeed against the
 *   TRUNCATED name, so the next plan's read (`WHERE datname = $1`, the name exactly as
 *   declared) would find nothing and try to create it again — forever. See
 *   `doc/postgres.md#name`.
 */
export class PostgresDatabaseNameRefused extends Data.TaggedError('PostgresDatabaseNameRefused')<{
  readonly name: string;
  readonly byteLength: number;
  readonly limit: number;
}> {
  override get message(): string {
    return (
      `Postgres.Database "${this.name}": ${String(this.byteLength)} UTF-8 bytes, over the ` +
      `${String(this.limit)}-byte limit (NAMEDATALEN 64, minus the terminator). PostgreSQL would ` +
      'accept the CREATE and silently truncate the name with only a NOTICE, so this plan refuses ' +
      'it instead of creating a database no later read will ever find again.'
    );
  }
}

/** A logical id's `name` changed. A database's name is its identity; there is no `ALTER … RENAME`
 * in this family's vocabulary (see `docs/postgres.md`), and `diff` never turns this into a
 * `replace` — a replace here is `DROP DATABASE` before `CREATE DATABASE`, on data. */
export class PostgresDatabaseRenameRefused extends Data.TaggedError(
  'PostgresDatabaseRenameRefused',
)<{
  readonly from: string;
  readonly to: string;
}> {
  override get message(): string {
    return (
      `Postgres.Database: the declared name changed from "${this.from}" to "${this.to}". A ` +
      'rename is refused at plan — this provider never replaces a database (that is DROP then ' +
      'CREATE) and never runs ALTER … RENAME. Declare a new logical id for the new name, and ' +
      'remove the old one once its data has moved.'
    );
  }
}

/** `OWNER` names a role `pg_roles` does not have, checked before the `CREATE DATABASE` that
 * would otherwise fail on it. Postgres itself refuses the same case with `ERROR:  role "…" does
 * not exist` (`createdb()`, `dbcommands.c`) — this tag exists so the refusal is typed and the
 * check runs before any statement, not caught from the driver's text. */
export class PostgresDatabaseOwnerMissing extends Data.TaggedError('PostgresDatabaseOwnerMissing')<{
  readonly database: string;
  readonly owner: string;
}> {
  override get message(): string {
    return `Postgres.Database "${this.database}": OWNER "${this.owner}" is not a role in pg_roles.`;
  }
}

/** A live, asserted property no longer matches the declaration. `reconcile` never issues an
 * `ALTER DATABASE` to fix this — see `docs/postgres.md` for why each asserted prop stops at
 * create. */
export class PostgresDatabaseDrift extends Data.TaggedError('PostgresDatabaseDrift')<{
  readonly database: string;
  readonly prop: string;
  readonly declared: unknown;
  readonly live: unknown;
}> {
  override get message(): string {
    return (
      `Postgres.Database "${this.database}": ${this.prop} is declared as ` +
      `${JSON.stringify(this.declared)} but the live database has ${JSON.stringify(this.live)}. ` +
      'This provider never issues ALTER DATABASE — update the declaration to match the live ' +
      'value, or change it by hand and re-plan.'
    );
  }
}

/** `delete` never drops a database. `DROP DATABASE` is destructive and irreversible on data
 * this family did not create from nothing (most declared databases here are adopted, not
 * created); the decision to remove one stays a human act on the host. */
export class PostgresDatabaseDropRefused extends Data.TaggedError('PostgresDatabaseDropRefused')<{
  readonly database: string;
}> {
  override get message(): string {
    return (
      `Postgres.Database "${this.database}": delete is refused. This provider never issues DROP ` +
      'DATABASE. Drop it by hand over the trust socket if you mean to remove it, then remove the ' +
      'declaration.'
    );
  }
}

/** `CREATE DATABASE` raised no error, but the immediate re-read (S10: never trust the write's
 * own report) still finds nothing. Measured to have no real trigger in a correctly speaking
 * client, but S20 forbids `Effect.die` here regardless — an invariant violation is a typed
 * failure the caller can see and retry, never a defect that crashes the whole engine. */
export class PostgresDatabaseCreateVanished extends Data.TaggedError(
  'PostgresDatabaseCreateVanished',
)<{
  readonly database: string;
}> {
  override get message(): string {
    return (
      `Postgres.Database "${this.database}": CREATE DATABASE raised no error, but the database ` +
      'is still absent on the immediate re-read. Re-plan — this is not a state this provider ' +
      'expects to reach.'
    );
  }
}

export type PostgresDatabaseError =
  | PostgresDatabaseNameRefused
  | PostgresDatabaseRenameRefused
  | PostgresDatabaseOwnerMissing
  | PostgresDatabaseDrift
  | PostgresDatabaseDropRefused
  | PostgresDatabaseCreateVanished;
