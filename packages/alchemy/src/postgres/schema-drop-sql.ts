/**
 * The atomic `DROP SCHEMA` `Postgres.Schema` issues: ONE `DO` statement that takes a lock,
 * re-proves the schema inside the same transaction, refuses what must not be dropped, and only
 * then drops.
 *
 * ⛔ PROOF AND DROP ARE ONE STATEMENT, ONE TRANSACTION. Before 2026-10-02 the re-read, the
 *   emptiness check and the `DROP` were three autocommit statements — three `psql` processes on
 *   the runner transport — so an out-of-band drop-and-recreate between them was dropped by name,
 *   `CASCADE` included (Opus read of PR 334). A `DO` block is atomic on both transports and needs
 *   no `BEGIN`/`COMMIT` the runner would have to thread through.
 * ★ THE LOCK IS `pg_advisory_xact_lock(<schema oid>)`, TAKEN BEFORE THE RE-VERIFY. `SELECT … FOR
 *   UPDATE` is not allowed on `pg_namespace` (system catalogs are not lockable that way) and
 *   `LOCK` takes a relation. It is cooperative — it serialises two runs of this provider (two
 *   stacks, a retry racing a crash), not an arbitrary `CREATE TABLE`. A creator that slips in
 *   after the proof is still caught: a plain `DROP` answers `2BP01` (typed as not-empty), and the
 *   server's own namespace lock orders the rest. `CASCADE` has no such second net, hence the
 *   cross-schema dependents refusal below.
 * ★ THE VALUES ARE LITERALS INSIDE THE BODY, AND THE BODY IS ONE `E'…'` LITERAL. A `DO` body
 *   takes no bind parameters, and a dollar-quote tag could be forged by a schema NAME containing
 *   it; `quoteStringLiteral` doubles backslashes and quotes, so nesting it twice is exact.
 *   The `DROP` text inside is `buildDropSchemaSql` run through `EXECUTE`, so the quoting rule is
 *   the same single one.
 * ★ REFUSALS ARE CUSTOM SQLSTATEs, read from `reason.cause.code` exactly like `2BP01`
 *   (`schema-sql.ts#isDependentObjectsError`): `HF001` identity changed, `HF002` not empty,
 *   `HF003` dependents in another schema. Class `HF` is not `42`, so both transports wrap it as
 *   `UnknownError` with the raw code. The `HF003` message carries a COUNT only: another owner's
 *   object names must not reach this stack's logs.
 */
import type { SqlError } from 'effect/unstable/sql/SqlError';
import { quoteStringLiteral } from './database-sql.ts';
import { buildDropSchemaSql, emptyPredicate } from './schema-sql.ts';

export const IDENTITY_CHANGED = 'HF001';
export const NOT_EMPTY = 'HF002';
export const CROSS_SCHEMA_DEPENDENTS = 'HF003';

export interface AtomicDrop {
  readonly name: string;
  readonly oid: number;
  readonly owner: string;
  readonly cascade: boolean;
}

/**
 * Objects in OTHER schemas that depend on an object in this one, so `DROP … CASCADE` would take
 * them too. The dependent's schema is resolved per catalog class; a class this does not know
 * yields NULL, which `IS DISTINCT FROM` counts as foreign — an unknown dependent fails CLOSED.
 * Only `n` (normal), `a` (auto) and `i` (internal) dependencies cascade (`catalogs.sgml`).
 */
const CROSS_SCHEMA_DEPENDENTS_SQL = `SELECT pg_catalog.count(*) INTO v_count
      FROM pg_catalog.pg_depend d
      JOIN (
        SELECT 'pg_catalog.pg_class'::pg_catalog.regclass AS cls, c.oid FROM pg_catalog.pg_class c WHERE c.relnamespace = v_ns
        UNION ALL SELECT 'pg_catalog.pg_type'::pg_catalog.regclass, t.oid FROM pg_catalog.pg_type t WHERE t.typnamespace = v_ns
        UNION ALL SELECT 'pg_catalog.pg_proc'::pg_catalog.regclass, p.oid FROM pg_catalog.pg_proc p WHERE p.pronamespace = v_ns
        UNION ALL SELECT 'pg_catalog.pg_operator'::pg_catalog.regclass, o.oid FROM pg_catalog.pg_operator o WHERE o.oprnamespace = v_ns
      ) r ON d.refclassid = r.cls AND d.refobjid = r.oid
      WHERE d.deptype IN ('n', 'a', 'i')
        AND (CASE d.classid
          WHEN 'pg_catalog.pg_class'::pg_catalog.regclass THEN (SELECT x.relnamespace FROM pg_catalog.pg_class x WHERE x.oid = d.objid)
          WHEN 'pg_catalog.pg_type'::pg_catalog.regclass THEN (SELECT x.typnamespace FROM pg_catalog.pg_type x WHERE x.oid = d.objid)
          WHEN 'pg_catalog.pg_proc'::pg_catalog.regclass THEN (SELECT x.pronamespace FROM pg_catalog.pg_proc x WHERE x.oid = d.objid)
          WHEN 'pg_catalog.pg_operator'::pg_catalog.regclass THEN (SELECT x.oprnamespace FROM pg_catalog.pg_operator x WHERE x.oid = d.objid)
          WHEN 'pg_catalog.pg_constraint'::pg_catalog.regclass THEN (SELECT x.connamespace FROM pg_catalog.pg_constraint x WHERE x.oid = d.objid)
          WHEN 'pg_catalog.pg_trigger'::pg_catalog.regclass THEN (SELECT c.relnamespace FROM pg_catalog.pg_trigger x JOIN pg_catalog.pg_class c ON c.oid = x.tgrelid WHERE x.oid = d.objid)
          WHEN 'pg_catalog.pg_rewrite'::pg_catalog.regclass THEN (SELECT c.relnamespace FROM pg_catalog.pg_rewrite x JOIN pg_catalog.pg_class c ON c.oid = x.ev_class WHERE x.oid = d.objid)
          WHEN 'pg_catalog.pg_attrdef'::pg_catalog.regclass THEN (SELECT c.relnamespace FROM pg_catalog.pg_attrdef x JOIN pg_catalog.pg_class c ON c.oid = x.adrelid WHERE x.oid = d.objid)
          WHEN 'pg_catalog.pg_policy'::pg_catalog.regclass THEN (SELECT c.relnamespace FROM pg_catalog.pg_policy x JOIN pg_catalog.pg_class c ON c.oid = x.polrelid WHERE x.oid = d.objid)
          WHEN 'pg_catalog.pg_default_acl'::pg_catalog.regclass THEN (SELECT x.defaclnamespace FROM pg_catalog.pg_default_acl x WHERE x.oid = d.objid)
        END) IS DISTINCT FROM v_ns`;

/** The whole atomic drop: lock → re-verify → refuse or drop. Pure text, no client. */
export const buildAtomicDropSql = (drop: AtomicDrop): string => {
  const body = `DECLARE
  v_name text := ${quoteStringLiteral(drop.name)};
  v_oid oid := ${String(Math.trunc(drop.oid))};
  v_owner text := ${quoteStringLiteral(drop.owner)};
  v_cascade boolean := ${drop.cascade ? 'true' : 'false'};
  v_ns oid;
  v_count bigint;
BEGIN
  SELECT n.oid INTO v_ns FROM pg_catalog.pg_namespace n WHERE n.nspname = v_name;
  IF v_ns IS NULL THEN RETURN; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(v_ns::pg_catalog.int8);
  SELECT n.oid INTO v_ns FROM pg_catalog.pg_namespace n
    WHERE n.nspname = v_name AND n.oid = v_oid
      AND pg_catalog.pg_get_userbyid(n.nspowner) = v_owner;
  IF v_ns IS NULL THEN
    RAISE EXCEPTION 'schema identity changed' USING ERRCODE = '${IDENTITY_CHANGED}';
  END IF;
  IF NOT v_cascade THEN
    IF NOT (${emptyPredicate('v_ns')}) THEN
      RAISE EXCEPTION 'schema not empty' USING ERRCODE = '${NOT_EMPTY}';
    END IF;
  ELSE
    ${CROSS_SCHEMA_DEPENDENTS_SQL};
    IF v_count > 0 THEN
      RAISE EXCEPTION 'cross-schema dependents: %', v_count USING ERRCODE = '${CROSS_SCHEMA_DEPENDENTS}';
    END IF;
  END IF;
  EXECUTE ${quoteStringLiteral(buildDropSchemaSql(drop.name, drop.cascade))};
END`;
  return `DO ${quoteStringLiteral(body)}`;
};

/** The server's SQLSTATE on a failed statement, whichever transport raised it. */
export const sqlStateOf = (error: SqlError): string | undefined => {
  const cause = error.reason.cause;
  const code =
    typeof cause === 'object' && cause !== null ? (cause as { code?: unknown }).code : '';
  return typeof code === 'string' ? code : undefined;
};

/** The dependents COUNT out of an `HF003` error. An unreadable message still refuses: it
 * answers 1, never 0 — the refusal is the fail-closed answer. */
export const dependentsCount = (error: SqlError): number => {
  const cause = error.reason.cause;
  const message = typeof cause === 'object' && cause !== null ? (cause as Error).message : '';
  const parsed = /dependents:\s*(\d+)/.exec(message ?? '')?.[1];
  return Math.max(1, Number(parsed ?? 1));
};
