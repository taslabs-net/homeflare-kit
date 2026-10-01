/** Apply repeats plan guards: unresolved Outputs can skip both diff and the adoption probe. */
import * as Effect from 'effect/Effect';
import type { PostgresSchemaAttributes, PostgresSchemaProps } from './schema-attrs.ts';
import {
  PostgresSchemaDatabaseRefused,
  PostgresSchemaIdentityRefused,
  PostgresSchemaRenameRefused,
} from './schema-errors.ts';

export const assertSchemaTarget = (
  props: PostgresSchemaProps,
  output: PostgresSchemaAttributes | undefined,
): Effect.Effect<void, PostgresSchemaRenameRefused | PostgresSchemaDatabaseRefused> =>
  Effect.gen(function* () {
    if (output === undefined) return;
    if (props.name !== output.name)
      return yield* Effect.fail(
        new PostgresSchemaRenameRefused({ from: output.name, to: props.name }),
      );
    if (props.database !== output.database)
      return yield* Effect.fail(
        new PostgresSchemaDatabaseRefused({ from: output.database, to: props.database }),
      );
  });

/** Like Role, refuse recycled names on read as well: drift must not refresh away the proof. */
export const assertSchemaIdentity = (
  live: PostgresSchemaAttributes,
  output: PostgresSchemaAttributes,
): Effect.Effect<void, PostgresSchemaIdentityRefused> =>
  live.oid === output.oid
    ? Effect.void
    : Effect.fail(
        new PostgresSchemaIdentityRefused({
          schema: live.name,
          storedOid: output.oid,
          liveOid: live.oid,
        }),
      );
