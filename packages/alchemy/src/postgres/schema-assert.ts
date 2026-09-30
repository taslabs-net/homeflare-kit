/**
 * Assert a just-read `pg_namespace` row against a `Postgres.Schema` declaration.
 *
 * ⛔ OWNER BEFORE COMMENT. `reconcile` calls `assertOwner` on the create re-read before any
 *   `COMMENT ON SCHEMA`. A concurrent creator can win `IF NOT EXISTS` (the `CREATE` then does
 *   nothing). The kit role is superuser, so commenting first rewrites their schema, and the
 *   later drift failure does not roll that write back — the two statements are not one
 *   transaction.
 * ⛔ AN OMITTED `owner` IS `current_user`, NOT "DON'T ASSERT". A fresh `CREATE SCHEMA` without
 *   `AUTHORIZATION` is owned by the role running it. Skipping the comparison when the prop is
 *   omitted returns that foreign row as reconciled, and a later `RemovalPolicy.destroy()` drops
 *   the other role's schema.
 */
import * as Effect from 'effect/Effect';
import {
  type PostgresSchemaAttributes,
  type PostgresSchemaProps,
  normalizedComment,
} from './schema-attrs.ts';
import { PostgresSchemaDrift } from './schema-errors.ts';

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
