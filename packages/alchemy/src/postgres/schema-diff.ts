/**
 * `Postgres.Schema`'s plan-time diff — entirely offline: `news` (declared) against `output`
 * (last-applied attributes) and `olds` (last-applied props), never a live query (that
 * authoritative check is `reconcileWithClient`'s, per S10). Extracted from `schema.ts` to keep
 * each file under the house's 250-line cap.
 *
 * ⛔ `cascade` COMPARES AGAINST `olds`, NOT `output`. Attributes are the live row (name,
 *   database, owner, comment, oid) — `cascade` is a prop-only concern no catalog column
 *   carries. The engine's noop branch (`Apply.ts`) commits the OLD props unchanged, so a
 *   `cascade` flip must answer `update` to reach the persisted state at all: a schema first
 *   declared `cascade: true` and later set to `false` would otherwise keep dropping with
 *   `CASCADE` on every delete, because `delete`'s `olds` are read from those persisted props.
 */
import { assertSchemaTarget } from './schema-identity.ts';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import type { PostgresSchemaAttributes, PostgresSchemaProps } from './schema-attrs.ts';
import { normalizedComment, schemaNameByteRefusal } from './schema-attrs.ts';
import { PostgresSchemaNameRefused } from './schema-errors.ts';

/** Plan-time only: rename refused, over-long name refused, a database move refused; a `cascade`
 * flip answers `update` so the new prop reaches state, and every other change answers `update`
 * too (which `reconcileWithClient` then applies as create, or refuses as drift on a live
 * schema). */
export const diffPostgresSchema = (
  news: Input<PostgresSchemaProps>,
  output: PostgresSchemaAttributes | undefined,
  olds?: PostgresSchemaProps,
) =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    yield* assertSchemaTarget(news, output);
    const nameRefusal = schemaNameByteRefusal(news.name);
    if (nameRefusal !== undefined) {
      return yield* Effect.fail(new PostgresSchemaNameRefused({ name: news.name, ...nameRefusal }));
    }
    const comment = normalizedComment(news.comment);
    const changed =
      (news.owner !== undefined && news.owner !== output.owner) ||
      (comment !== undefined && comment !== (output.comment ?? undefined)) ||
      (news.cascade ?? false) !== (olds?.cascade ?? false);
    return changed ? ({ action: 'update' } as const) : ({ action: 'noop' } as const);
  });
