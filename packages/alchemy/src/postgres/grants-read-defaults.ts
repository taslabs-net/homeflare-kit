/**
 * The default-privilege half of the grants read: what `pg_default_acl` says the declared
 * role receives on relations (`defaclobjtype = 'r'`, the only object type this family
 * declares — `pg_default_acl.h@REL_18_6#DEFACLOBJ_RELATION`) created in the schema,
 * whatever role created the entry. Extracted from `grants-read.ts` so that file stays
 * under the 250-line cap; the read still goes through `aclexplode` (see that file's
 * header for the doctrine), never the `aclitem` text.
 */
import * as Effect from 'effect/Effect';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import type { PgExecutor } from './database-sql.ts';
import { type AclRow, encodeWord } from './grants-words.ts';

/** One row per default-privilege entry on relations in the schema, with the declared
 * role's words, whatever role created the entry. Sorted by forRole so two reads of the
 * same state compare equal. */
const DEFAULTS_SQL = `SELECT
    pg_catalog.pg_get_userbyid(d.defaclrole) AS for_role,
    a.privilege_type AS privilege,
    a.is_grantable AS grantable
  FROM pg_catalog.pg_default_acl d
  CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS a
  WHERE d.defaclnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = $1)
    AND d.defaclobjtype = 'r'
    AND a.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $2)
  ORDER BY for_role`;

export interface LiveDefault {
  readonly forRole: string;
  readonly role: ReadonlyArray<string>;
}

export const readDefaultAcls = (
  pg: PgExecutor,
  schema: string,
  role: string,
): Effect.Effect<ReadonlyArray<LiveDefault>, SqlError> =>
  Effect.map(
    pg.unsafe<{ readonly for_role: string } & AclRow>(DEFAULTS_SQL, [schema, role]),
    (rows) => {
      const byRole = new Map<string, string[]>();
      for (const row of rows) {
        const words = byRole.get(row.for_role) ?? [];
        words.push(encodeWord(row));
        byRole.set(row.for_role, words);
      }
      return [...byRole.entries()]
        .map(([forRole, words]) => ({ forRole, role: [...new Set(words)].sort() }))
        .sort((a, b) => a.forRole.localeCompare(b.forRole));
    },
  );
