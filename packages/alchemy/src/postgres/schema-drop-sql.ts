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
 * ⛔ THE LOCK MUST CONFLICT WITH DDL, NOT ONLY WITH OTHER RUNS OF THIS PROVIDER. An advisory lock
 *   (`pg_advisory_xact_lock`) is cooperative: an ordinary `DROP SCHEMA` + `CREATE SCHEMA` ignores
 *   it, and the by-name `DROP` below would then drop the REPLACEMENT, `CASCADE` included (Codex
 *   read of PR 357, 2026-10-06). So, BEFORE the re-verify and held to the end of the transaction:
 *   (1) `COMMENT ON SCHEMA <name> IS <its current comment>` — `CommentObject` resolves the schema
 *   through `get_object_address(…, ShareUpdateExclusiveLock)`, which locks the namespace OBJECT
 *   (`LockDatabaseObject`), and `DROP SCHEMA` takes `AccessExclusiveLock` on that same object
 *   (`AcquireDeletionLock`), so a concurrent drop waits for us; (2) on a cascade, `LOCK TABLE …
 *   IN ACCESS EXCLUSIVE MODE` on every table-like relation in the schema, which holds off a
 *   concurrent creator of a dependent (a view or foreign key reads the table it references).
 *   Lock modes: PostgreSQL docs, explicit-locking.html §13.3; `COMMENT`: sql-comment.html.
 *   `lock_timeout` turns any wait into `55P03`, an unclassified error: the drop is REFUSED, never
 *   forced. A comment-less schema is rewritten as `IS NULL`, which still takes the lock.
 * ⚠️ NOT COVERED: `ALTER SCHEMA … RENAME` takes no such object lock, so a rename-and-recreate
 *   between the re-verify and the `DROP` is still a window of a few statements; and a type,
 *   function or collation created in ANOTHER schema to use ours has no relation to wait on. The
 *   advisory lock stays: it serialises runs of this provider, which is cheap and correct.
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
import { OUTSIDE_DEPENDENTS_SQL } from './schema-closure-sql.ts';
import { buildDropSchemaSql, emptyPredicate } from './schema-sql.ts';

export const IDENTITY_CHANGED = 'HF001';
export const NOT_EMPTY = 'HF002';
export const CROSS_SCHEMA_DEPENDENTS = 'HF003';

/** How long any lock in the block may wait before the drop is refused (`55P03`, fails closed). */
const LOCK_TIMEOUT = '10s';

export interface AtomicDrop {
  readonly name: string;
  readonly oid: number;
  readonly owner: string;
  readonly cascade: boolean;
}

/** The whole atomic drop: lock → re-verify → refuse or drop. Pure text, no client. */
export const buildAtomicDropSql = (drop: AtomicDrop): string => {
  const body = `DECLARE
  v_name text := ${quoteStringLiteral(drop.name)};
  v_oid oid := ${String(Math.trunc(drop.oid))};
  v_owner text := ${quoteStringLiteral(drop.owner)};
  v_cascade boolean := ${drop.cascade ? 'true' : 'false'};
  v_ns oid;
  v_count bigint;
  v_comment text;
  v_rel text;
BEGIN
  SELECT n.oid INTO v_ns FROM pg_catalog.pg_namespace n WHERE n.nspname = v_name;
  IF v_ns IS NULL THEN RETURN; END IF;
  PERFORM pg_catalog.set_config('lock_timeout', '${LOCK_TIMEOUT}', true);
  PERFORM pg_catalog.pg_advisory_xact_lock(v_ns::pg_catalog.int8);
  v_comment := pg_catalog.obj_description(v_ns, 'pg_namespace');
  EXECUTE pg_catalog.format('COMMENT ON SCHEMA %I IS %L', v_name, v_comment);
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
    FOR v_rel IN SELECT c.oid::pg_catalog.regclass::pg_catalog.text FROM pg_catalog.pg_class c
        WHERE c.relnamespace = v_ns AND c.relkind IN ('r', 'p', 'v', 'm', 'f') ORDER BY c.oid LOOP
      EXECUTE pg_catalog.format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE', v_rel);
    END LOOP;
    ${OUTSIDE_DEPENDENTS_SQL};
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
