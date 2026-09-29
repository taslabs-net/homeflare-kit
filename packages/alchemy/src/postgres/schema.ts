/**
 * `Postgres.Schema` — create-and-assert over one schema in a self-hosted PostgreSQL 18 cluster.
 *
 * ★ A SCHEMA CARRIES NO OWNERSHIP MARK, exactly like `Postgres.Database` (H1). `read` answers
 *   `Unowned` for a match, so every already-live schema needs `adopt(true)` in the stack that
 *   declares it.
 * ⛔ NOT ALTER-CAPABLE. `ALTER SCHEMA` only renames or changes owner in Postgres; neither is
 *   implemented. An owner or comment mismatch against the live row is a typed
 *   `PostgresSchemaDrift` refusal, never an `ALTER SCHEMA` — same rule `Postgres.Database`
 *   applies to its own asserted props.
 * ⛔ `delete` DROPS ONLY WHEN SAFE. `DROP SCHEMA` refuses a non-empty schema unless
 *   `cascade: true` is declared (`PostgresSchemaDropNotEmptyError`); the `cascade` prop
 *   defaults to `false` (retain policy by default — see `defaultRemovalPolicy: 'retain'`).
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import type { PostgresSchemaAttributes, PostgresSchemaProps } from './schema-attrs.ts';
import { schemaNameByteRefusal } from './schema-attrs.ts';
import {
  buildCommentSchemaSql,
  buildCreateSchemaSql,
  buildDropSchemaSql,
  schemaIsEmpty,
  selectSchema,
} from './schema-sql.ts';
import { roleExists } from './database-sql.ts';
import type { PgExecutor } from './database-sql.ts';
import { type PostgresConnection, withPg } from './connection.ts';
import {
  PostgresSchemaCreateVanished,
  PostgresSchemaDrift,
  PostgresSchemaDropNotEmptyError,
  PostgresSchemaNameRefused,
  PostgresSchemaOwnerMissing,
  PostgresSchemaRenameRefused,
} from './schema-errors.ts';

export interface PostgresSchema extends Resource<
  'Postgres.Schema',
  PostgresSchemaProps,
  PostgresSchemaAttributes,
  never,
  PostgresConnection
> {}

export const PostgresSchema = Resource<PostgresSchema>('Postgres.Schema', {
  defaultRemovalPolicy: 'retain',
});

/** Same dual `typeof` guard as `isPostgresDatabase` (see `database.ts`): a resource constructor
 * is a callable `Object.assign`ed function, not a plain object. */
export const isPostgresSchema = (value: unknown): value is PostgresSchema =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  (value as { Type?: unknown }).Type === 'Postgres.Schema';

/** Owner and comment are the only asserted props: both compared against the live row. */
const liveDrift = (props: PostgresSchemaProps, live: PostgresSchemaAttributes) => {
  if (props.owner !== undefined && props.owner !== live.owner) {
    return { prop: 'owner', declared: props.owner, live: live.owner };
  }
  if (props.comment !== undefined && props.comment !== (live.comment ?? undefined)) {
    return { prop: 'comment', declared: props.comment, live: live.comment };
  }
  return undefined;
};

/**
 * The core of `reconcile`, against any {@link PgExecutor} — the real pooled client through
 * `withPg`, or `fake-sql.ts`'s recording fake in tests.
 */
export const reconcileWithClient = (
  pg: PgExecutor,
  props: PostgresSchemaProps,
): Effect.Effect<
  PostgresSchemaAttributes,
  PostgresSchemaOwnerMissing | PostgresSchemaDrift | PostgresSchemaCreateVanished | SqlError
> =>
  Effect.gen(function* () {
    const observed = yield* selectSchema(pg, props.name);
    if (observed === undefined) {
      if (props.owner !== undefined) {
        const ownerPresent = yield* roleExists(pg, props.owner);
        if (!ownerPresent) {
          return yield* Effect.fail(
            new PostgresSchemaOwnerMissing({ schema: props.name, owner: props.owner }),
          );
        }
      }
      yield* pg.unsafe(buildCreateSchemaSql(props)).pipe(Effect.asVoid);
      // Never trust the write's own report (S10): re-read what the server actually stored.
      const created = yield* selectSchema(pg, props.name);
      if (created === undefined) {
        return yield* Effect.fail(new PostgresSchemaCreateVanished({ schema: props.name }));
      }
      if (props.comment !== undefined && props.comment !== (created.comment ?? undefined)) {
        yield* pg.unsafe(buildCommentSchemaSql(props.name, props.comment)).pipe(Effect.asVoid);
        const commented = yield* selectSchema(pg, props.name);
        if (commented === undefined) {
          return yield* Effect.fail(new PostgresSchemaCreateVanished({ schema: props.name }));
        }
        return commented;
      }
      return created;
    }
    const drift = liveDrift(props, observed);
    if (drift !== undefined) {
      return yield* Effect.fail(
        new PostgresSchemaDrift({
          schema: props.name,
          prop: drift.prop,
          declared: drift.declared,
          live: drift.live,
        }),
      );
    }
    return observed;
  });

/** The core of `read`: one bound `SELECT`, no ownership branding. */
export const readWithClient = (pg: PgExecutor, name: string) => selectSchema(pg, name);

/** The core of `drop`, against any {@link PgExecutor}: refuses a non-empty schema without
 * `cascade`, then issues one idempotent `DROP SCHEMA`. */
export const dropWithClient = (
  pg: PgExecutor,
  props: PostgresSchemaProps,
): Effect.Effect<void, PostgresSchemaDropNotEmptyError | SqlError> =>
  Effect.gen(function* () {
    if (props.cascade !== true) {
      const empty = yield* schemaIsEmpty(pg, props.name);
      if (!empty) {
        return yield* Effect.fail(new PostgresSchemaDropNotEmptyError({ schema: props.name }));
      }
    }
    yield* pg.unsafe(buildDropSchemaSql(props.name, props.cascade === true)).pipe(Effect.asVoid);
  });

/** Plan-time only: rename refused, over-long name refused, any other change answers `update`
 * (which `reconcileWithClient` then applies as create, or refuses as drift on a live schema). */
export const diffPostgresSchema = (
  news: Input<PostgresSchemaProps>,
  output: PostgresSchemaAttributes | undefined,
) =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    if (news.name !== output.name) {
      return yield* Effect.fail(
        new PostgresSchemaRenameRefused({ from: output.name, to: news.name }),
      );
    }
    const nameRefusal = schemaNameByteRefusal(news.name);
    if (nameRefusal !== undefined) {
      return yield* Effect.fail(new PostgresSchemaNameRefused({ name: news.name, ...nameRefusal }));
    }
    const changed =
      (news.owner !== undefined && news.owner !== output.owner) ||
      (news.comment !== undefined && news.comment !== (output.comment ?? undefined));
    return changed ? ({ action: 'update' } as const) : ({ action: 'noop' } as const);
  });

/** The five lifecycle handlers. Exported on its own so a test drives the real implementation. */
export const postgresSchemaHandlers = PostgresSchema.Provider.of({
  // ⚠️ EMPTY, NOT A LIVE SWEEP — same reasoning as Postgres.Database's list.
  list: () => Effect.succeed([]),
  nuke: { skip: true },

  read: ({ olds, output }) =>
    Effect.gen(function* () {
      const name = output?.name ?? olds.name;
      const live = yield* withPg((pg) => readWithClient(pg, name));
      return live === undefined ? undefined : Unowned(live);
    }),

  diff: ({ news, output }) => diffPostgresSchema(news, output),

  reconcile: ({ news }) =>
    Effect.gen(function* () {
      const nameRefusal = schemaNameByteRefusal(news.name);
      if (nameRefusal !== undefined) {
        return yield* Effect.fail(
          new PostgresSchemaNameRefused({ name: news.name, ...nameRefusal }),
        );
      }
      return yield* withPg((pg) => reconcileWithClient(pg, news));
    }),

  delete: ({ olds }) => withPg((pg) => dropWithClient(pg, olds)),
});

export const PostgresSchemaProvider = () =>
  Provider.succeed(PostgresSchema, postgresSchemaHandlers);
