/** Schema reconcile: prove the stored target and identity before asserting a live row. */
import * as Effect from 'effect/Effect';
import type { SqlError } from 'effect/sql/SqlError';
import { type PgExecutor, roleExists } from './database-sql.ts';
import {
  type PostgresSchemaAttributes,
  type PostgresSchemaProps,
  normalizedComment,
} from './schema-attrs.ts';
import { assertDatabase, assertLive, assertOwner } from './schema-assert.ts';
import { assertSchemaIdentity, assertSchemaTarget } from './schema-identity.ts';
import {
  buildCommentSchemaSql,
  buildCreateSchemaSql,
  currentUser,
  isDuplicateSchemaError,
  selectSchema,
} from './schema-sql.ts';
import {
  PostgresSchemaCreateVanished,
  type PostgresSchemaDatabaseRefused,
  type PostgresSchemaDrift,
  PostgresSchemaExistsRefused,
  type PostgresSchemaIdentityRefused,
  PostgresSchemaOwnerMissing,
  type PostgresSchemaRenameRefused,
  type PostgresSchemaWrongDatabase,
} from './schema-errors.ts';

/**
 * The core of `reconcile`, against any {@link PgExecutor} — the real pooled client through
 * `withPg`, or `fake-sql.ts`'s recording fake in tests.
 */
export const reconcileWithClient = (
  pg: PgExecutor,
  props: PostgresSchemaProps,
  output?: PostgresSchemaAttributes,
): Effect.Effect<
  PostgresSchemaAttributes,
  | PostgresSchemaWrongDatabase
  | PostgresSchemaOwnerMissing
  | PostgresSchemaDrift
  | PostgresSchemaCreateVanished
  | PostgresSchemaExistsRefused
  | PostgresSchemaIdentityRefused
  | PostgresSchemaRenameRefused
  | PostgresSchemaDatabaseRefused
  | SqlError
> =>
  Effect.gen(function* () {
    yield* assertSchemaTarget(props, output);
    yield* assertDatabase(props, pg);
    // Only an omitted owner needs the session role: a declared owner is the comparison itself.
    const executingRole = props.owner !== undefined ? props.owner : yield* currentUser(pg);
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
      // REL_18_6 pg_namespace.c: duplicate_schema is 42P06. Never turn a race into adoption.
      const createRefusal = (error: SqlError): PostgresSchemaExistsRefused | SqlError =>
        isDuplicateSchemaError(error)
          ? new PostgresSchemaExistsRefused({ schema: props.name, database: props.database })
          : error;
      yield* pg.unsafe(buildCreateSchemaSql(props)).pipe(
        Effect.asVoid,
        Effect.catchTag('SqlError', (error) => Effect.fail(createRefusal(error))),
      );
      // Never trust the write's own report (S10): re-read what the server actually stored.
      const created = yield* selectSchema(pg, props.name);
      if (created === undefined) {
        return yield* Effect.fail(new PostgresSchemaCreateVanished({ schema: props.name }));
      }
      // Owner before COMMENT ON (schema-assert.ts): preserve the post-write assertion too;
      // duplicate CREATE already refused the race before this re-read.
      yield* assertOwner(props, created, executingRole);
      const comment = normalizedComment(props.comment);
      if (comment !== undefined && comment !== (created.comment ?? undefined)) {
        yield* pg.unsafe(buildCommentSchemaSql(props.name, comment)).pipe(Effect.asVoid);
        const commented = yield* selectSchema(pg, props.name);
        if (commented === undefined) {
          return yield* Effect.fail(new PostgresSchemaCreateVanished({ schema: props.name }));
        }
        return yield* assertLive(props, commented, executingRole);
      }
      return yield* assertLive(props, created, executingRole);
    }
    if (output === undefined) {
      return yield* Effect.fail(
        new PostgresSchemaExistsRefused({ schema: props.name, database: props.database }),
      );
    }
    yield* assertSchemaIdentity(observed, output);
    return yield* assertLive(props, observed, executingRole);
  });
