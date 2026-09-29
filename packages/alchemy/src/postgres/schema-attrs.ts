/**
 * Props and live attributes for `Postgres.Schema`.
 *
 * Backed by `pg_namespace` (`nspname`, `nspowner`, `oid`) and `pg_description`
 * (`obj_description(n.oid, 'pg_namespace')`).
 *
 * `CREATE SCHEMA` options are limited: only `IF NOT EXISTS`, the schema name and an optional
 * `AUTHORIZATION` roleMeaningful altering options do not exist for schema (`ALTER SCHEMA` only
 * renames or changes owner in Postgres, neither of which this family implements — see
 * `docs/postgres.md` for why `Postgres.Database` refuses all `ALTER DATABASE`).
 */
import { POSTGRES_NAME_MAX_BYTES, utf8ByteLength } from './database-attrs.ts';

export interface PostgresSchemaProps {
  /** Schema name. At most 63 UTF-8 bytes (`NAMEDATALEN`), refused at plan. */
  readonly name: string;
  /** Owning role; becomes `AUTHORIZATION` in `CREATE SCHEMA`. The role must already exist. */
  readonly owner?: string;
  /** Optional `COMMENT ON SCHEMA`. Stored in `pg_description`. */
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
  /** Owner role name (`pg_get_userbyid(nspowner)`). */
  readonly owner: string;
  /** Comment from `obj_description`, `null` when none. */
  readonly comment: string | null;
  /** `pg_namespace` OID, read as a native `oid` number. */
  readonly oid: number;
}

/** Refuse names PostgreSQL would truncate silently (see `database-attrs.ts`). */
export const schemaNameByteRefusal = (
  name: string,
): { readonly byteLength: number; readonly limit: number } | undefined => {
  const byteLength = utf8ByteLength(name);
  return byteLength > POSTGRES_NAME_MAX_BYTES
    ? { byteLength, limit: POSTGRES_NAME_MAX_BYTES }
    : undefined;
};
