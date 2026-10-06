/** PG18 lexical §4.1.2.2 regressions: exercise the fake and the executor's actual stdin. */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeFakeSql } from './fake-sql.ts';
import { parseLiteral } from './fake-sql-quote.ts';
import { buildCommentSchemaSql } from './schema-sql.ts';
import { buildSetPasswordSql } from './role-sql.ts';
import { makePsqlExecutor, redactPasswordLiterals } from './psql-executor.ts';
import { stripPin } from './search-path.ts';

const payload = "\\'; CREATE SCHEMA injected; --";
const target = { database: 'postgres', username: 'postgres' };
const row = { name: 'ledger', database: 'postgres', owner: 'postgres', oid: 42, comment: null };

for (const on of [true, false]) {
  test(`fake comment round-trips hostile text with standard_conforming_strings=${String(on)}`, async () => {
    const fake = makeFakeSql({ schemas: [row], standardConformingStrings: on });
    await Effect.runPromise(fake.unsafe(buildCommentSchemaSql('ledger', payload)));
    expect(fake.schemas.get('ledger')?.comment).toBe(payload);
    expect(fake.schemas.has('injected')).toBe(false);
  });

  test(`psql executor comment and bound param stay one literal with standard_conforming_strings=${String(on)}`, async () => {
    const fake = makeFakeSql({ schemas: [row], standardConformingStrings: on });
    const calls: string[] = [];
    const pg = makePsqlExecutor(async ({ stdin: raw }) => {
      const stdin = stripPin(raw);
      calls.push(stdin);
      if (stdin.startsWith('COMMENT')) {
        await Effect.runPromise(fake.unsafe(stdin.slice(0, -1)));
        return { code: 0, stdout: '', stderr: '' };
      }
      const prefix = "SELECT coalesce(json_agg(t), '[]'::json)::text FROM (SELECT ";
      expect(stdin.startsWith(prefix)).toBe(true);
      const literal = stdin.slice(prefix.length, -' AS value) t;'.length);
      const value = parseLiteral(literal, on);
      return { code: 0, stdout: JSON.stringify([{ value }]), stderr: '' };
    }, target);
    await Effect.runPromise(pg.unsafe(buildCommentSchemaSql('ledger', payload)));
    const rows = await Effect.runPromise(
      pg.unsafe<{ value: string }>('SELECT $1 AS value', [payload]),
    );
    expect(rows).toEqual([{ value: payload }]);
    expect(fake.schemas.get('ledger')?.comment).toBe(payload);
    expect(fake.schemas.has('injected')).toBe(false);
    expect(calls[0]).toContain("IS E'\\\\''; CREATE SCHEMA injected; --'");
  });
}

test('escape-literal regression oracle rejects the old injection when the setting is off', () => {
  expect(() => parseLiteral("'\\''; CREATE SCHEMA injected; --'", false)).toThrow('trailing SQL');
});

test('Role password redaction covers escape strings, including escaped quotes and backslashes', async () => {
  const statement = buildSetPasswordSql('seat', "verifier\\'tail");
  expect(redactPasswordLiterals(statement)).toBe('ALTER ROLE "seat" WITH PASSWORD \'[redacted]\'');
  const pg = makePsqlExecutor(
    async () => ({
      code: 3,
      stdout: '',
      stderr: `ERROR:  42501: refused\nSTATEMENT: ${statement}`,
    }),
    target,
  );
  const error = await Effect.runPromise(Effect.flip(pg.unsafe(statement)));
  expect(JSON.stringify(error)).not.toContain('verifier');
  expect(JSON.stringify(error)).not.toContain('tail');
  expect(redactPasswordLiterals("PASSWORD 'legacy'")).toBe("PASSWORD '[redacted]'");
});
