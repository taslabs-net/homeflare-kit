/**
 * `Postgres.Schema`'s failures as typed tags, following the `Postgres.Database` pattern (S21).
 *
 * Refusals use checked catalog facts or raw SQLSTATE (42P06 / 2BP01), never driver message text.
 */
import * as Data from 'effect/Data';

/** A declared name would be silently truncated (same as `PostgresDatabaseNameRefused`). */
export class PostgresSchemaNameRefused extends Data.TaggedError('PostgresSchemaNameRefused')<{
  readonly name: string;
  readonly byteLength: number;
  readonly limit: number;
}> {
  override get message(): string {
    return (
      `Postgres.Schema "${this.name}": ${String(this.byteLength)} UTF-8 bytes, over the ` +
      `${String(this.limit)}-byte limit (NAMEDATALEN 64, minus the terminator). PostgreSQL would ` +
      'accept the CREATE and silently truncate the name with only a NOTICE, so this plan refuses ' +
      'it instead of creating a schema no later read will ever find again.'
    );
  }
}

/** A logical id's `name` changed. A schema's name is its identity; this family has no
 * `ALTER SCHEMA … RENAME`. */
export class PostgresSchemaRenameRefused extends Data.TaggedError('PostgresSchemaRenameRefused')<{
  readonly from: string;
  readonly to: string;
}> {
  override get message(): string {
    return (
      `Postgres.Schema: the declared name changed from "${this.from}" to "${this.to}". A ` +
      'rename is refused during plan or apply — this provider never runs ALTER SCHEMA … RENAME. Declare a new ' +
      'logical id for the new name and remove the old one once its contents have moved.'
    );
  }
}

/** `owner` names a role `pg_roles` does not have, checked before the `CREATE SCHEMA`. */
export class PostgresSchemaOwnerMissing extends Data.TaggedError('PostgresSchemaOwnerMissing')<{
  readonly schema: string;
  readonly owner: string;
}> {
  override get message(): string {
    return `Postgres.Schema "${this.schema}": AUTHORIZATION "${this.owner}" is not a role in pg_roles.`;
  }
}

/** A live asserted prop no longer matches the declaration (`owner` or `comment`). */
export class PostgresSchemaDrift extends Data.TaggedError('PostgresSchemaDrift')<{
  readonly schema: string;
  readonly prop: string;
  readonly declared: unknown;
  readonly live: unknown;
}> {
  override get message(): string {
    return (
      `Postgres.Schema "${this.schema}": ${this.prop} is declared as ` +
      `${JSON.stringify(this.declared)} but the live schema has ${JSON.stringify(this.live)}. ` +
      'This provider never issues ALTER SCHEMA — update the declaration to match the live value, ' +
      'or change it by hand and re-plan.'
    );
  }
}

/** `CREATE SCHEMA` raised no error, but the immediate re-read (S10) still finds nothing. */
export class PostgresSchemaCreateVanished extends Data.TaggedError('PostgresSchemaCreateVanished')<{
  readonly schema: string;
}> {
  override get message(): string {
    return (
      `Postgres.Schema "${this.schema}": CREATE SCHEMA raised no error, but the schema is still ` +
      'absent on the immediate re-read. Re-plan — this is not a state this provider expects to reach.'
    );
  }
}

/**
 * `delete` with `cascade: false` refuses a schema that still has relations. The same refusal
 * answers a plain `DROP SCHEMA` the server rejected with SQLSTATE `2BP01`
 * (`dependent_objects_still_exist`) — an object kind the emptiness check's four catalogs do not
 * cover (an extension, a collation) — so no "empty" path escapes the typed tag.
 */
export class PostgresSchemaDropNotEmptyError extends Data.TaggedError(
  'PostgresSchemaDropNotEmptyError',
)<{
  readonly schema: string;
}> {
  override get message(): string {
    return (
      `Postgres.Schema "${this.schema}": DROP SCHEMA refused because the schema is not empty and ` +
      'cascade is false. Declare cascade: true to drop its contents, or empty it by hand first.'
    );
  }
}

/** Every statement this resource issues must run against the DECLARED database. The family
 * connection points at a maintenance database, so the schema handlers open `props.database`
 * themselves (`withPg`'s database override); this failure means the server answered
 * `current_database()` with something else — the override was ignored, and no read or write
 * ran against the schema's real home. */
export class PostgresSchemaWrongDatabase extends Data.TaggedError('PostgresSchemaWrongDatabase')<{
  readonly schema: string;
  readonly declared: string;
  readonly connected: string;
}> {
  override get message(): string {
    return (
      `Postgres.Schema "${this.schema}": declared in database "${this.declared}" but the ` +
      `connection answers current_database() "${this.connected}". The handlers open the declared ` +
      'database themselves, so this points at broken provider wiring — fix it before touching any ' +
      'schema, or the next create would land in the wrong database.'
    );
  }
}

/**
 * `delete` refuses to drop a live schema that is not the one this resource created. The
 * engine hands `delete` the persisted state (`output`, with the `oid` and `owner` the last
 * assert proved), and the provider re-reads `pg_namespace` before any `DROP` — a live row that
 * no longer matches that proof is someone else's schema wearing the same name (the old row was
 * dropped out of band and the name recreated), and `DROP SCHEMA` would remove their objects.
 * Nothing is dropped: clear the out-of-band schema by hand, or adopt it.
 */
export class PostgresSchemaDeleteForeignRefused extends Data.TaggedError(
  'PostgresSchemaDeleteForeignRefused',
)<{
  readonly schema: string;
  readonly database: string;
  readonly liveOid: number;
  readonly liveOwner: string;
  /** The proof the persisted state carries; both `undefined` when no state was handed over. */
  readonly lastOid: number | undefined;
  readonly lastOwner: string | undefined;
}> {
  override get message(): string {
    const proof =
      this.lastOid === undefined || this.lastOwner === undefined
        ? 'delete carried no persisted oid/owner to prove ownership'
        : `the persisted proof is oid ${String(this.lastOid)}, owner "${this.lastOwner}"`;
    return (
      `Postgres.Schema "${this.schema}": the live schema in database "${this.database}" (oid ` +
      `${String(this.liveOid)}, owner "${this.liveOwner}") is not the one this resource created — ` +
      `${proof}. No DROP was issued: a schema with this name was created out of band. Drop it by ` +
      'hand, or adopt it on a resource whose declared props match it.'
    );
  }
}

/** A logical id's `database` changed. A schema lives in one database and this family never
 * moves one: `DROP SCHEMA` in the old database plus a new declaration is the only path. */
export class PostgresSchemaDatabaseRefused extends Data.TaggedError(
  'PostgresSchemaDatabaseRefused',
)<{
  readonly from: string;
  readonly to: string;
}> {
  override get message(): string {
    return (
      `Postgres.Schema: the declared database changed from "${this.from}" to "${this.to}". A ` +
      'schema is never moved across databases — declare a new logical id in the new database and ' +
      'remove the old one once its contents have moved.'
    );
  }
}

/** No persisted proof: even a same-owner schema needs explicit adoption, including recovery. */
export class PostgresSchemaExistsRefused extends Data.TaggedError('PostgresSchemaExistsRefused')<{
  readonly schema: string;
  readonly database: string;
}> {
  override get message(): string {
    return (
      `Postgres.Schema "${this.schema}" in "${this.database}" already exists. Re-plan with ` +
      '--adopt (adopt(true)) to adopt it explicitly; crash recovery also requires adoption. ' +
      'No existing schema was changed.'
    );
  }
}

/** Reconcile must not replace the oid delete relies on with an out-of-band replacement's oid. */
export class PostgresSchemaIdentityRefused extends Data.TaggedError(
  'PostgresSchemaIdentityRefused',
)<{
  readonly schema: string;
  readonly storedOid: number;
  readonly liveOid: number;
}> {
  override get message(): string {
    return (
      `Postgres.Schema "${this.schema}": live oid ${String(this.liveOid)} differs from stored oid ` +
      `${String(this.storedOid)}. The schema was dropped and recreated outside this stack. ` +
      'Remove stale state and explicitly adopt the replacement before managing it.'
    );
  }
}

export type PostgresSchemaError =
  | PostgresSchemaExistsRefused
  | PostgresSchemaIdentityRefused
  | PostgresSchemaNameRefused
  | PostgresSchemaRenameRefused
  | PostgresSchemaOwnerMissing
  | PostgresSchemaDrift
  | PostgresSchemaCreateVanished
  | PostgresSchemaDropNotEmptyError
  | PostgresSchemaDeleteForeignRefused
  | PostgresSchemaWrongDatabase
  | PostgresSchemaDatabaseRefused;
