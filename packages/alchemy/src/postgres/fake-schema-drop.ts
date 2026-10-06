/**
 * The fake's reading of the atomic `DO` drop `schema-drop-sql.ts` emits.
 *
 * ⛔ IT PARSES ITS OWN OUTPUT (the rule `fake-sql.ts` documents): the four `DECLARE` literals are
 *   read back out of the generated text and the block's decisions are replayed against the
 *   in-memory catalog in the same order the SQL makes them — absent → return, identity, empty or
 *   cross-schema dependents, drop. A changed block shape fails the parse loudly.
 */
import * as Effect from 'effect/Effect';
import { SqlError, UnknownError } from 'effect/unstable/sql/SqlError';
import { parseLiteral } from './fake-sql-quote.ts';
import { parseDropSchema } from './fake-sql-parse.ts';
import type { FakeSchemaState } from './fake-schema-sql.ts';
import {
  CASCADE_SEQUENCES,
  CROSS_SCHEMA_DEPENDENTS,
  IDENTITY_CHANGED,
  NOT_EMPTY,
} from './schema-drop-sql.ts';

const refusal = (code: string, message: string): SqlError =>
  new SqlError({
    reason: new UnknownError({
      cause: Object.assign(new Error(message), { code }),
      message,
      operation: 'DO',
    }),
  });

/** `E'…'` literal at the end of a generated line, decoded. */
const literalAfter = (body: string, label: string): string => {
  const match = new RegExp(`${label} [a-z]+ := (E'(?:[^']|'')*');`).exec(body);
  if (match === null) throw new Error(`fake-sql: could not parse DO block ${label}: ${body}`);
  return parseLiteral(match[1] as string);
};

export const applyAtomicDrop = (
  state: FakeSchemaState,
  text: string,
): Effect.Effect<ReadonlyArray<never>, SqlError> => {
  const body = parseLiteral(text.slice('DO '.length));
  const name = literalAfter(body, 'v_name');
  const owner = literalAfter(body, 'v_owner');
  const oid = Number(/v_oid oid := (\d+);/.exec(body)?.[1]);
  const cascade = /v_cascade boolean := (true|false);/.exec(body)?.[1] === 'true';
  const drop = /EXECUTE (E'(?:[^']|'')*');/.exec(body)?.[1];
  if (drop === undefined || Number.isNaN(oid)) {
    throw new Error(`fake-sql: could not parse DO block: ${body}`);
  }
  if (parseDropSchema(parseLiteral(drop)).name !== name) {
    throw new Error('fake-sql: DO block drops a different schema than it proves');
  }
  const row = state.schemas.get(name);
  if (row === undefined) return Effect.succeed([]);
  if (row.oid !== oid || row.owner !== owner) {
    return Effect.fail(refusal(IDENTITY_CHANGED, 'schema identity changed'));
  }
  if (!cascade) {
    if (state.relationsIn.has(name)) return Effect.fail(refusal(NOT_EMPTY, 'schema not empty'));
  } else {
    const sequences = state.sequencesIn.get(name) ?? 0;
    if (sequences > 0) {
      return Effect.fail(refusal(CASCADE_SEQUENCES, `cascade sequences: ${String(sequences)}`));
    }
    const outside = state.dependentsOutside.get(name) ?? 0;
    if (outside > 0) {
      return Effect.fail(
        refusal(CROSS_SCHEMA_DEPENDENTS, `cross-schema dependents: ${String(outside)}`),
      );
    }
    state.relationsIn.delete(name);
  }
  state.schemas.delete(name);
  return Effect.succeed([]);
};
