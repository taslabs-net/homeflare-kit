/**
 * Props and live attributes for `Postgres.Schema`.
 *
 * Backed by `pg_namespace` (`nspname`, `nspowner`, `oid`) and `pg_description`
 * (`obj_description(n.oid, 'pg_namespace')`).
 *
 * `CREATE SCHEMA` options are limited: only `IF NOT EXISTS`, the schema name and an optional
 * `AUTHORIZATION` role. No altering option exists for a schema (`ALTER SCHEMA` only renames or
 * changes owner in Postgres, neither of which this family implements — see `docs/postgres.md`
 * for why `Postgres.Database` refuses all `ALTER DATABASE`).
 */
import { POSTGRES_NAME_MAX_BYTES, utf8ByteLength } from './database-attrs.ts';

export interface PostgresSchemaProps {
  /** Schema name. At most 63 UTF-8 bytes (`NAMEDATALEN`), refused at plan. */
  readonly name: string;
  /**
   * The database the schema lives in. The family connection points at a maintenance database
   * (`docs/postgres.md#measured-path` — a brand-new database cannot be connected to on a cold
   * plan), so the schema handlers open THIS database instead and prove it with
   * `current_database()` (`PostgresSchemaWrongDatabase`) before any write. A change is refused
   * at plan (`PostgresSchemaDatabaseRefused`) the same way a rename is.
   */
  readonly database: string;
  /** Owning role; becomes `AUTHORIZATION` in `CREATE SCHEMA`. The role must already exist. */
  readonly owner?: string;
  /**
   * Optional `COMMENT ON SCHEMA`. Stored in `pg_description`. A declared `''` IS "no comment":
   * Postgres stores an empty comment as NULL, so it is normalized to `undefined`
   * (`normalizedComment`) rather than compared against a live NULL forever.
   */
  readonly comment?: string;
  /**
   * Whether `DELETE` with `RemovalPolicy.destroy()` may cascade into objects in the schema.
   * Default `false`: `DROP SCHEMA` refuses when the schema is not empty.
   */
  readonly cascade?: boolean;
}

export interface PostgresSchemaAttributes {
  /** Schema name (`pg_namespace.nspname`). */
  readonly name: string;
  /** The database the row was read from (`current_database()`), equal to the declared prop on
   * every honest read — the row itself carries the proof of where the statement ran. */
  readonly database: string;
  /** Owner role name (`pg_get_userbyid(nspowner)`). */
  readonly owner: string;
  /** Comment from `obj_description`, `null` when none. */
  readonly comment: string | null;
  /** `pg_namespace` OID, read as a native `oid` number. */
  readonly oid: number;
}

/**
 * A declared `''` comment means "no comment": `COMMENT ON SCHEMA … IS ''` deletes the comment in
 * Postgres (the stored value becomes NULL), so treating `''` as a value would drift against the
 * live NULL on every later plan — a permanent update loop. Normalizing it to `undefined` keeps
 * `''` and an absent comment identical everywhere they are compared.
 */
export const normalizedComment = (comment: string | undefined): string | undefined =>
  comment === '' ? undefined : comment;

/** Refuse names PostgreSQL would silently truncate (see `database-attrs.ts`). */
export const schemaNameByteRefusal = (
  name: string,
): { readonly byteLength: number; readonly limit: number } | undefined => {
  const byteLength = utf8ByteLength(name);
  return byteLength > POSTGRES_NAME_MAX_BYTES
    ? { byteLength, limit: POSTGRES_NAME_MAX_BYTES }
    : undefined;
};
