/**
 * Assert a just-read `pg_namespace` row — and the connection that read it — against a
 * `Postgres.Schema` declaration.
 *
 * ⛔ OWNER BEFORE COMMENT. `reconcile` calls `assertOwner` on the create re-read before any
 *   `COMMENT ON SCHEMA`. Measured before the 2026-10-01 fix: a concurrent creator could win
 *   `IF NOT EXISTS` (the `CREATE` did nothing). Plain CREATE now refuses that race. The kit role
 *   is superuser, so commenting first rewrites their schema, and the later drift failure does not roll that write back — the two statements are not one
 *   transaction.
 * ⛔ AN OMITTED `owner` IS `current_user`, NOT "DON'T ASSERT". A fresh `CREATE SCHEMA` without
 *   `AUTHORIZATION` is owned by the role running it. Skipping the comparison when the prop is
 *   omitted returns that foreign row as reconciled, and a later `RemovalPolicy.destroy()` drops
 *   the other role's schema.
 * ⛔ DELETE RE-READS AND PROVES OWNERSHIP (`deleteForeignRefusal`). `DROP SCHEMA` fires by
 *   name alone; the name is no proof the live schema is the one this resource created — the
 *   old row can be dropped out of band and the name recreated by another role, and the engine
 *   hands `delete` no re-read of its own once state exists. The persisted `oid` + `owner`
 *   (what the last reconcile asserted) are the proof: a live row that does not match them is
 *   refused, and nothing is dropped.
 */
import * as Effect from 'effect/Effect';
import type { SqlError } from 'effect/sql/SqlError';
import type { PgExecutor } from './database-sql.ts';
import {
  type PostgresSchemaAttributes,
  type PostgresSchemaProps,
  normalizedComment,
} from './schema-attrs.ts';
import {
  PostgresSchemaDeleteForeignRefused,
  PostgresSchemaDrift,
  PostgresSchemaWrongDatabase,
} from './schema-errors.ts';
import { currentDatabase } from './schema-sql.ts';

/** The connected database, proven equal to the declaration or refused — the guard every write
 * path in this family runs first. */
export const assertDatabase = (
  props: PostgresSchemaProps,
  pg: PgExecutor,
): Effect.Effect<void, PostgresSchemaWrongDatabase | SqlError> =>
  Effect.flatMap(currentDatabase(pg), (connected) =>
    connected === props.database
      ? Effect.void
      : Effect.fail(
          new PostgresSchemaWrongDatabase({
            schema: props.name,
            declared: props.database,
            connected,
          }),
        ),
  );

/** The role a fresh `CREATE SCHEMA` without `AUTHORIZATION` would be owned by. */
export const declaredOwner = (props: PostgresSchemaProps, executingRole: string): string =>
  props.owner ?? executingRole;

const ownerDrift = (
  props: PostgresSchemaProps,
  live: PostgresSchemaAttributes,
  executingRole: string,
): { readonly prop: 'owner'; readonly declared: string; readonly live: string } | undefined => {
  const declared = declaredOwner(props, executingRole);
  return declared === live.owner ? undefined : { prop: 'owner', declared, live: live.owner };
};

/** Owner, then comment. An omitted owner is `executingRole` (`current_user`), so a race
 * winner owned by someone else is drift on every return path, not only the create path. */
export const liveDrift = (
  props: PostgresSchemaProps,
  live: PostgresSchemaAttributes,
  executingRole: string,
): { readonly prop: string; readonly declared: unknown; readonly live: unknown } | undefined => {
  const owner = ownerDrift(props, live, executingRole);
  if (owner !== undefined) return owner;
  const comment = normalizedComment(props.comment);
  if (comment !== undefined && comment !== (live.comment ?? undefined)) {
    return { prop: 'comment', declared: comment, live: live.comment };
  }
  return undefined;
};

const refuse = (
  props: PostgresSchemaProps,
  drift: { readonly prop: string; readonly declared: unknown; readonly live: unknown },
): Effect.Effect<never, PostgresSchemaDrift> =>
  Effect.fail(
    new PostgresSchemaDrift({
      schema: props.name,
      prop: drift.prop,
      declared: drift.declared,
      live: drift.live,
    }),
  );

/** Owner only — the check that runs before `COMMENT ON`, so a race winner is never commented. */
export const assertOwner = (
  props: PostgresSchemaProps,
  row: PostgresSchemaAttributes,
  executingRole: string,
): Effect.Effect<void, PostgresSchemaDrift> => {
  const drift = ownerDrift(props, row, executingRole);
  return drift === undefined ? Effect.void : refuse(props, drift);
};

/** Owner and comment. Every return path of `reconcile` passes through this. */
export const assertLive = (
  props: PostgresSchemaProps,
  row: PostgresSchemaAttributes,
  executingRole: string,
): Effect.Effect<PostgresSchemaAttributes, PostgresSchemaDrift> => {
  const drift = liveDrift(props, row, executingRole);
  return drift === undefined ? Effect.succeed(row) : refuse(props, drift);
};

/**
 * The delete-time ownership proof: `undefined` when the live row is provably the one this
 * resource created (same `oid` and `owner` as the persisted state handed to `delete`), else
 * the typed refusal — with `lastOid`/`lastOwner` `undefined` when no state was handed over,
 * the fail-closed shape (the handler type allows `output === undefined` even though the
 * engine passes state whenever it calls delete).
 */
export const deleteForeignRefusal = (
  props: PostgresSchemaProps,
  live: PostgresSchemaAttributes,
  output: PostgresSchemaAttributes | undefined,
): PostgresSchemaDeleteForeignRefused | undefined => {
  if (output !== undefined && output.oid === live.oid && output.owner === live.owner) {
    return undefined;
  }
  return new PostgresSchemaDeleteForeignRefused({
    schema: props.name,
    database: props.database,
    liveOid: live.oid,
    liveOwner: live.owner,
    lastOid: output?.oid,
    lastOwner: output?.owner,
  });
};
