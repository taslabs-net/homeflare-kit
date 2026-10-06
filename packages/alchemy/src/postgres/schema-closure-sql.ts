/**
 * The dependency closure `DROP SCHEMA … CASCADE` would walk, and the count of what it would take
 * that does NOT live in the schema being dropped (`schema-drop-sql.ts` refuses when it is > 0).
 *
 * ⛔ THE CLOSURE IS DERIVED FROM THE NAMESPACE OBJECT, NOT FROM A LIST OF CLASSES. Until
 *   2026-10-06 the scan started from four catalogs (`pg_class`, `pg_type`, `pg_proc`,
 *   `pg_operator`), so `a.c` (a collation) used by `b.t.x` was invisible and the cascade reached
 *   into `b.t.x` (Codex read of PR 357). Now the walk starts at `(pg_namespace, v_ns)` and follows
 *   EVERY `pg_depend` row whose referenced object is already inside — the same edges
 *   `findDependentObjects` (`dependency.c`) follows — so any object class `pg_depend` can name
 *   (collation, conversion, opclass, opfamily, text-search, statistics, extension members, …)
 *   is reached with no catalog enumerated to find it.
 * ★ EVERY `deptype` FOLLOWS (`pg_depend`, catalogs.sgml); they differ only in attribution:
 *     n NORMAL    cascade drops the dependent        → followed; foreign if it lives elsewhere
 *     a AUTO      dropped with any drop              → followed; foreign if it lives elsewhere
 *                 (an owned sequence in another schema is dropped with its table)
 *     i INTERNAL  a part of the referenced object    → followed; attributed to its owner (below)
 *     P / S       partition primary / secondary      → followed; a partition in another
 *                 schema is dropped with its parent, so it is foreign
 *     e EXTENSION member of an extension             → followed; the extension's members are
 *                 dropped with it, wherever they live
 *     x AUTO-EXT  auto, and dropped with the extension → followed like `a`
 *     p PIN       system object, `refobjid = 0`      → never a referenced row, never joins
 * ★ "INSIDE" is a home-schema test per class. TOAST is the case the old scan got wrong: a text
 *   table's TOAST relation (and its index) lives in `pg_toast` and depends internally on the
 *   table, so it is attributed to the table that owns it via `reltoastrelid` — otherwise every
 *   cascade of a schema with a text column was refused. Constraints, triggers, rules, policies
 *   and defaults have no schema of their own and take their table's.
 * ⚠️ A CLASS THIS FILE DOES NOT KNOW (a cast, a foreign server, a language, an event trigger)
 *   resolves to NULL, which is NOT inside: it counts as foreign. Unknown fails CLOSED. The walk
 *   stops at a foreign object — one is enough to refuse.
 * ★ A dependent created AFTER this scan is held off by the caller's locks (`schema-drop-sql.ts`).
 */

const cls = (name: string): string => `'pg_catalog.${name}'::pg_catalog.regclass`;

/** `WHEN <class> THEN <namespace column of the row>` for a catalog that carries its own. */
const direct = (table: string, column: string): string =>
  `WHEN ${cls(table)} THEN (SELECT x.${column} FROM pg_catalog.${table} x WHERE x.oid = d.objid)`;

/** The same for an object with no schema of its own: the schema of the relation it hangs on. */
const viaRelation = (table: string, column: string): string =>
  `WHEN ${cls(table)} THEN (SELECT c.relnamespace FROM pg_catalog.${table} x JOIN pg_catalog.pg_class c ON c.oid = x.${column} WHERE x.oid = d.objid)`;

/** An access-method member belongs to its operator family. */
const viaFamily = (table: string, column: string): string =>
  `WHEN ${cls(table)} THEN (SELECT f.opfnamespace FROM pg_catalog.${table} x JOIN pg_catalog.pg_opfamily f ON f.oid = x.${column} WHERE x.oid = d.objid)`;

/** A relation's home. A TOAST relation, or the index on one, is its owner's. */
const RELATION_HOME = `WHEN ${cls('pg_class')} THEN COALESCE(
            (SELECT o.relnamespace FROM pg_catalog.pg_class o
              WHERE o.reltoastrelid <> 0
                AND o.reltoastrelid IN (d.objid, (SELECT i.indrelid FROM pg_catalog.pg_index i WHERE i.indexrelid = d.objid))),
            (SELECT x.relnamespace FROM pg_catalog.pg_class x WHERE x.oid = d.objid))`;

const HOME_OF_DEPENDENT = `CASE d.classid
          WHEN ${cls('pg_namespace')} THEN d.objid
          ${RELATION_HOME}
          ${direct('pg_type', 'typnamespace')}
          ${direct('pg_proc', 'pronamespace')}
          ${direct('pg_operator', 'oprnamespace')}
          ${direct('pg_collation', 'collnamespace')}
          ${direct('pg_conversion', 'connamespace')}
          ${direct('pg_opclass', 'opcnamespace')}
          ${direct('pg_opfamily', 'opfnamespace')}
          ${direct('pg_ts_config', 'cfgnamespace')}
          ${direct('pg_ts_dict', 'dictnamespace')}
          ${direct('pg_ts_parser', 'prsnamespace')}
          ${direct('pg_ts_template', 'tmplnamespace')}
          ${direct('pg_statistic_ext', 'stxnamespace')}
          ${direct('pg_constraint', 'connamespace')}
          ${direct('pg_default_acl', 'defaclnamespace')}
          ${direct('pg_extension', 'extnamespace')}
          ${viaRelation('pg_trigger', 'tgrelid')}
          ${viaRelation('pg_rewrite', 'ev_class')}
          ${viaRelation('pg_attrdef', 'adrelid')}
          ${viaRelation('pg_policy', 'polrelid')}
          ${viaRelation('pg_publication_rel', 'prrelid')}
          ${viaFamily('pg_amop', 'amopfamily')}
          ${viaFamily('pg_amproc', 'amprocfamily')}
        END`;

/** `v_count := …`: how many objects the cascade would drop outside `v_ns`. */
export const OUTSIDE_DEPENDENTS_SQL = `v_count := (
      WITH RECURSIVE reach (classid, objid, inside) AS (
        SELECT ${cls('pg_namespace')}::pg_catalog.oid, v_ns, true
        UNION
        SELECT d.classid, d.objid, (${HOME_OF_DEPENDENT}) IS NOT DISTINCT FROM v_ns
        FROM pg_catalog.pg_depend d
        JOIN reach r ON d.refclassid = r.classid AND d.refobjid = r.objid AND r.inside
        WHERE d.deptype <> 'p'
      )
      SELECT pg_catalog.count(*) FROM reach WHERE NOT inside
    )`;
