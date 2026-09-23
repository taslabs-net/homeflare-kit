/**
 * Every plan-time refusal, checked without a client: name-byte precision, identifier and string
 * quoting, the rename refusal, a full sweep proving `diff` never answers `replace`, and `delete`.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as Effect from 'effect/Effect';
import { POSTGRES_NAME_MAX_BYTES, nameByteRefusal, utf8ByteLength } from './database-attrs.ts';
import { buildCreateDatabaseSql, quoteIdent, quoteStringLiteral } from './database-sql.ts';
import { diffPostgresDatabase, postgresDatabaseHandlers } from './database.ts';
import { PostgresDatabaseDropRefused, PostgresDatabaseRenameRefused } from './errors.ts';
import type { PostgresDatabaseAttributes, PostgresDatabaseProps } from './database-attrs.ts';

describe('name byte length', () => {
  test('a 63-byte ASCII name is accepted', () => {
    const name = 'a'.repeat(63);
    expect(utf8ByteLength(name)).toBe(63);
    expect(nameByteRefusal(name)).toBeUndefined();
  });

  test('a 64-byte ASCII name is refused', () => {
    const name = 'a'.repeat(64);
    const refusal = nameByteRefusal(name);
    expect(refusal).toEqual({ byteLength: 64, limit: POSTGRES_NAME_MAX_BYTES });
  });

  test('a 63-byte multibyte name (21 three-byte characters) is accepted, though .length is 21', () => {
    // U+4E2D ("中") is 3 UTF-8 bytes. 21 * 3 = 63 bytes exactly — the last size that survives.
    const name = '中'.repeat(21);
    expect(name.length).toBe(21);
    expect(utf8ByteLength(name)).toBe(63);
    expect(nameByteRefusal(name)).toBeUndefined();
  });

  test('one more multibyte character (64 bytes) is refused', () => {
    const name = `${'中'.repeat(21)}a`;
    expect(utf8ByteLength(name)).toBe(64);
    expect(nameByteRefusal(name)).toEqual({ byteLength: 64, limit: POSTGRES_NAME_MAX_BYTES });
  });
});

describe('quoting', () => {
  test('quoteIdent doubles an embedded double quote and leaves a hyphen alone', () => {
    expect(quoteIdent('a"b-c')).toBe('"a""b-c"');
  });

  test('quoteIdent does not split a dot the way a qualified-name escaper would', () => {
    // The hazard this file exists to avoid — see database-sql.ts's header.
    expect(quoteIdent('my.app')).toBe('"my.app"');
  });

  test('quoteStringLiteral doubles an embedded single quote', () => {
    expect(quoteStringLiteral("en_US.UTF-8'; DROP")).toBe("'en_US.UTF-8''; DROP'");
  });

  test('buildCreateDatabaseSql never string-concatenates an unescaped value', () => {
    const sql = buildCreateDatabaseSql({ name: 'db"1', owner: 'ro"le', encoding: "UT'F8" });
    expect(sql).toBe('CREATE DATABASE "db""1" WITH OWNER "ro""le" ENCODING \'UT\'\'F8\'');
  });
});

const sampleOutput: PostgresDatabaseAttributes = {
  name: 'widgets',
  oid: 1,
  owner: 'tim',
  encoding: 'UTF8',
  localeProvider: 'libc',
  collate: 'C',
  ctype: 'C',
  allowConnections: true,
  connectionLimit: -1,
  isTemplate: false,
  tablespace: 'pg_default',
};
const base: PostgresDatabaseProps = { name: 'widgets', owner: 'tim' };

describe('diff', () => {
  const output = sampleOutput;

  test('a rename is refused at plan, before reconcile ever runs', async () => {
    const error = await Effect.runPromise(
      Effect.flip(diffPostgresDatabase({ ...base, name: 'gadgets' }, output)),
    );
    expect(error).toBeInstanceOf(PostgresDatabaseRenameRefused);
  });

  test('an unchanged declaration answers noop', async () => {
    const result = await Effect.runPromise(diffPostgresDatabase(base, output));
    expect(result).toEqual({ action: 'noop' });
  });

  test('a change in any single prop answers update, and NEVER replace — swept across every prop', async () => {
    const variants: ReadonlyArray<Partial<PostgresDatabaseProps>> = [
      { owner: 'someone-else' },
      { encoding: 'LATIN1' },
      { localeProvider: 'icu' },
      { lcCollate: 'en_US.UTF-8' },
      { lcCtype: 'en_US.UTF-8' },
      { allowConnections: false },
      { connectionLimit: 5 },
      { isTemplate: true },
      { tablespace: 'fast_ssd' },
    ];
    for (const variant of variants) {
      const result = await Effect.runPromise(diffPostgresDatabase({ ...base, ...variant }, output));
      expect(result?.action, `variant ${JSON.stringify(variant)}`).toBe('update');
      expect(result).not.toEqual({ action: 'replace' });
    }
  });
});

describe('delete', () => {
  test('the real handler refuses with PostgresDatabaseDropRefused naming the database', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        postgresDatabaseHandlers.delete({
          id: 'x',
          fqn: 'x',
          instanceId: 'x',
          olds: base,
          output: sampleOutput,
          session: undefined as never,
          bindings: [] as never,
        }),
      ),
    );
    expect(error).toBeInstanceOf(PostgresDatabaseDropRefused);
    expect((error as PostgresDatabaseDropRefused).database).toBe('widgets');
  });

  test('defaultRemovalPolicy is retain (declared alongside PostgresDatabase, checked in source)', () => {
    const source = readFileSync(new URL('./database.ts', import.meta.url), 'utf8');
    expect(source).toContain("defaultRemovalPolicy: 'retain'");
  });
});
