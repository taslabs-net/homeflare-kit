/**
 * Every plan-time refusal for `Postgres.Schema`, checked without a client: name-byte
 * precision, identifier and literal quoting, the rename and database-move refusals, and the
 * sweep proving `diff` never answers `replace` — including the `cascade` flip compared against
 * `olds` so the change reaches the persisted props. The real handlers over the runner transport
 * live in `schema-handlers.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { POSTGRES_NAME_MAX_BYTES, utf8ByteLength } from './database-attrs.ts';
import { quoteIdent, quoteStringLiteral } from './database-sql.ts';
import { buildCommentSchemaSql, buildCreateSchemaSql } from './schema-sql.ts';
import { schemaNameByteRefusal } from './schema-attrs.ts';
import type { PostgresSchemaAttributes, PostgresSchemaProps } from './schema-attrs.ts';
import { diffPostgresSchema } from './schema-diff.ts';
import {
  PostgresSchemaDatabaseRefused,
  PostgresSchemaNameRefused,
  PostgresSchemaRenameRefused,
} from './schema-errors.ts';

describe('name byte length', () => {
  test('a 63-byte ASCII name is accepted', () => {
    const name = 'a'.repeat(63);
    expect(utf8ByteLength(name)).toBe(63);
    expect(schemaNameByteRefusal(name)).toBeUndefined();
  });

  test('a 64-byte ASCII name is refused', () => {
    const name = 'a'.repeat(64);
    const refusal = schemaNameByteRefusal(name);
    expect(refusal).toEqual({ byteLength: 64, limit: POSTGRES_NAME_MAX_BYTES });
  });

  test('a 63-byte multibyte name (21 three-byte characters) is accepted, though .length is 21', () => {
    // U+4E2D ("中") is 3 UTF-8 bytes. 21 * 3 = 63 bytes exactly — the last size that survives.
    const name = '中'.repeat(21);
    expect(name.length).toBe(21);
    expect(utf8ByteLength(name)).toBe(63);
    expect(schemaNameByteRefusal(name)).toBeUndefined();
  });

  test('one more multibyte character (64 bytes) is refused', () => {
    const name = `${'中'.repeat(21)}a`;
    expect(utf8ByteLength(name)).toBe(64);
    expect(schemaNameByteRefusal(name)).toEqual({ byteLength: 64, limit: POSTGRES_NAME_MAX_BYTES });
  });

  test('the typed refusal names the truncation danger in its message', () => {
    expect(
      new PostgresSchemaNameRefused({ name: 'x', byteLength: 64, limit: 63 }).message,
    ).toContain('silently truncate');
  });
});

describe('quoting', () => {
  test('quoteIdent doubles an embedded double quote and leaves a hyphen alone', () => {
    expect(quoteIdent('a"b-c')).toBe('"a""b-c"');
  });

  test('quoteStringLiteral doubles an embedded single quote', () => {
    expect(quoteStringLiteral("seat ledger'; DROP")).toBe("E'seat ledger''; DROP'");
  });

  test('buildCreateSchemaSql never string-concatenates an unescaped value', () => {
    const sql = buildCreateSchemaSql({ name: 'sc"1', database: 'postgres', owner: 'ro"le' });
    expect(sql).toBe('CREATE SCHEMA "sc""1" AUTHORIZATION "ro""le"');
  });

  test('buildCommentSchemaSql never string-concatenates an unescaped comment', () => {
    const sql = buildCommentSchemaSql('sc"1', "it'; DROP");
    expect(sql).toBe(`COMMENT ON SCHEMA "sc""1" IS E'it''; DROP'`);
  });
});

const sampleOutput: PostgresSchemaAttributes = {
  name: 'ledger',
  database: 'postgres',
  oid: 1,
  owner: 'tim',
  comment: null,
};
const base: PostgresSchemaProps = { name: 'ledger', database: 'postgres', owner: 'tim' };

describe('diff', () => {
  test('a rename is refused at plan, before reconcile ever runs', async () => {
    const error = await Effect.runPromise(
      Effect.flip(diffPostgresSchema({ ...base, name: 'gadgets' }, sampleOutput, base)),
    );
    expect(error).toBeInstanceOf(PostgresSchemaRenameRefused);
  });

  test('a database move is refused at plan, the same way a rename is', async () => {
    const error = await Effect.runPromise(
      Effect.flip(diffPostgresSchema({ ...base, database: 'agents' }, sampleOutput, base)),
    );
    expect(error).toBeInstanceOf(PostgresSchemaDatabaseRefused);
  });

  test('an unchanged declaration answers noop', async () => {
    const result = await Effect.runPromise(diffPostgresSchema(base, sampleOutput, base));
    expect(result).toEqual({ action: 'noop' });
  });

  test('an unchanged cascade answers noop even when the previous declaration carried it', async () => {
    const result = await Effect.runPromise(
      diffPostgresSchema({ ...base, cascade: true }, sampleOutput, { ...base, cascade: true }),
    );
    expect(result).toEqual({ action: 'noop' });
  });

  test('a change in any single prop answers update, and NEVER replace — swept across every prop', async () => {
    const variants: ReadonlyArray<Partial<PostgresSchemaProps>> = [
      { owner: 'someone-else' },
      { comment: 'changed' },
      { cascade: true },
    ];
    for (const variant of variants) {
      const result = await Effect.runPromise(
        diffPostgresSchema({ ...base, ...variant }, sampleOutput, base),
      );
      expect(result?.action, `variant ${JSON.stringify(variant)}`).toBe('update');
      expect(result).not.toEqual({ action: 'replace' });
    }
  });

  test('a cascade flip answers update in BOTH directions — compared against olds, so the flip reaches the persisted props', async () => {
    // The engine's noop branch commits the old props (Apply.ts), so a cascade flip that
    // answered noop would leave the persisted props carrying the OLD value forever: a schema
    // first declared cascade: true would keep dropping with CASCADE even after the
    // declaration said false.
    const down = await Effect.runPromise(
      diffPostgresSchema(base, sampleOutput, { ...base, cascade: true }),
    );
    expect(down?.action).toBe('update');
  });

  test('a declared empty comment diffs as "no comment", never as a change against a NULL', async () => {
    const result = await Effect.runPromise(
      diffPostgresSchema({ ...base, comment: '' }, sampleOutput, base),
    );
    expect(result).toEqual({ action: 'noop' });
  });
});
