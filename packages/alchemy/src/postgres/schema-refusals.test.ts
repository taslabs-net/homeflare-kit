/**
 * Every plan-time refusal for `Postgres.Schema`, checked without a client: name-byte precision,
 * quoting, the rename refusal, a sweep proving `diff` never answers `replace`, and the real
 * handler's drop path with its retain default.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as Effect from 'effect/Effect';
import { POSTGRES_NAME_MAX_BYTES, utf8ByteLength } from './database-attrs.ts';
import { quoteIdent, quoteStringLiteral } from './database-sql.ts';
import { postgresRunnerConnection } from './connection.ts';
import { buildCommentSchemaSql, buildCreateSchemaSql } from './schema-sql.ts';
import { type PsqlRunner } from './psql-executor.ts';
import { schemaNameByteRefusal } from './schema-attrs.ts';
import type { PostgresSchemaAttributes, PostgresSchemaProps } from './schema-attrs.ts';
import { diffPostgresSchema, postgresSchemaHandlers } from './schema.ts';
import {
  PostgresSchemaDropNotEmptyError,
  PostgresSchemaNameRefused,
  PostgresSchemaRenameRefused,
} from './schema-errors.ts';

const ok = (stdout: string) => Promise.resolve({ code: 0, stdout, stderr: '' });

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
    expect(quoteStringLiteral("seat ledger'; DROP")).toBe("'seat ledger''; DROP'");
  });

  test('buildCreateSchemaSql never string-concatenates an unescaped value', () => {
    const sql = buildCreateSchemaSql({ name: 'sc"1', owner: 'ro"le' });
    expect(sql).toBe('CREATE SCHEMA IF NOT EXISTS "sc""1" AUTHORIZATION "ro""le"');
  });

  test('buildCommentSchemaSql never string-concatenates an unescaped comment', () => {
    const sql = buildCommentSchemaSql('sc"1', "it'; DROP");
    expect(sql).toBe('COMMENT ON SCHEMA "sc""1" IS \'it\'\'; DROP\'');
  });
});

const sampleOutput: PostgresSchemaAttributes = {
  name: 'ledger',
  oid: 1,
  owner: 'tim',
  comment: null,
};
const base: PostgresSchemaProps = { name: 'ledger', owner: 'tim' };

describe('diff', () => {
  test('a rename is refused at plan, before reconcile ever runs', async () => {
    const error = await Effect.runPromise(
      Effect.flip(diffPostgresSchema({ ...base, name: 'gadgets' }, sampleOutput)),
    );
    expect(error).toBeInstanceOf(PostgresSchemaRenameRefused);
  });

  test('an unchanged declaration answers noop', async () => {
    const result = await Effect.runPromise(diffPostgresSchema(base, sampleOutput));
    expect(result).toEqual({ action: 'noop' });
  });

  test('a change in any single prop answers update, and NEVER replace — swept across every prop', async () => {
    const variants: ReadonlyArray<Partial<PostgresSchemaProps>> = [
      { owner: 'someone-else' },
      { comment: 'changed' },
    ];
    for (const variant of variants) {
      const result = await Effect.runPromise(
        diffPostgresSchema({ ...base, ...variant }, sampleOutput),
      );
      expect(result?.action, `variant ${JSON.stringify(variant)}`).toBe('update');
      expect(result).not.toEqual({ action: 'replace' });
    }
  });
});

describe('delete handler', () => {
  // The handler's drop runs through `withPg`, which needs a PostgresConnection; the loopback
  // runner transport provides one from a recording `PsqlRunner`, no live database involved —
  // the same wiring `psql-executor.test.ts` drives `reconcileWithClient` through.
  test('the real handler drops an empty schema over the runner transport, no CASCADE', async () => {
    const stdins: string[] = [];
    const run: PsqlRunner = ({ stdin }) => {
      stdins.push(stdin);
      if (stdin.includes('AS empty')) return ok('[{"empty":true}]');
      return ok('');
    };
    await Effect.runPromise(
      postgresSchemaHandlers
        .delete({
          id: 'x',
          fqn: 'x',
          instanceId: 'x',
          olds: { name: 'ledger', owner: 'tim' },
          output: sampleOutput,
          session: undefined as never,
          bindings: [] as never,
        })
        .pipe(
          Effect.provide(
            postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
          ),
        ),
    );
    expect(stdins.find((s) => s.startsWith('DROP SCHEMA'))).toBe('DROP SCHEMA IF EXISTS "ledger";');
    expect(stdins.some((s) => s.includes('CASCADE'))).toBe(false);
  });

  test('the real handler refuses a non-empty schema over the runner transport, no DROP issued', async () => {
    const stdins: string[] = [];
    const run: PsqlRunner = ({ stdin }) => {
      stdins.push(stdin);
      if (stdin.includes('AS empty')) return ok('[{"empty":false}]');
      return ok('');
    };
    const error = await Effect.runPromise(
      Effect.flip(
        postgresSchemaHandlers
          .delete({
            id: 'x',
            fqn: 'x',
            instanceId: 'x',
            olds: { name: 'ledger', owner: 'tim' },
            output: sampleOutput,
            session: undefined as never,
            bindings: [] as never,
          })
          .pipe(
            Effect.provide(
              postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
            ),
          ),
      ),
    );
    expect(error).toBeInstanceOf(PostgresSchemaDropNotEmptyError);
    expect(stdins.some((s) => s.startsWith('DROP SCHEMA'))).toBe(false);
  });

  test('defaultRemovalPolicy is retain (declared alongside PostgresSchema, checked in source)', () => {
    const source = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8');
    expect(source).toContain("defaultRemovalPolicy: 'retain'");
  });
});
