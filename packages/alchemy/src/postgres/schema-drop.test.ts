/**
 * `Postgres.Schema`'s atomic drop (`schema-drop-sql.ts`) against `fake-sql.ts`: one `DO`
 * statement that re-verifies identity under a lock, refuses a non-empty schema or cross-schema
 * dependents, and only then drops. The Opus read of PR 334 (2026-10-02) found the old
 * three-autocommit drop racy, and `cascade: true` reaching other stacks' objects.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { SqlError, UnknownError } from 'effect/unstable/sql/SqlError';
import type { PgExecutor } from './database-sql.ts';
import { makeFakeSql } from './fake-sql.ts';
import type { PostgresSchemaAttributes, PostgresSchemaProps } from './schema-attrs.ts';
import { buildAtomicDropSql } from './schema-drop-sql.ts';
import {
  PostgresSchemaCascadeCrossSchemaRefused,
  PostgresSchemaDeleteForeignRefused,
  PostgresSchemaDropNotEmptyError,
} from './schema-errors.ts';
import { deleteWithClient, dropWithClient } from './schema.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

const baseProps: PostgresSchemaProps = { name: 'ledger', database: 'postgres', owner: 'tim' };
const liveRow = (over: Partial<PostgresSchemaAttributes> = {}): PostgresSchemaAttributes => ({
  name: 'ledger',
  database: 'postgres',
  oid: 30000,
  owner: 'tim',
  comment: null,
  ...over,
});
const drops = (fake: ReturnType<typeof makeFakeSql>) =>
  fake.statements.filter((s) => s.text.startsWith('DO '));

describe('drop: the proof and the DROP are one statement', () => {
  test('an empty schema is dropped by ONE DO carrying the proven oid and owner', async () => {
    const fake = makeFakeSql({ schemas: [liveRow()] });
    await run(dropWithClient(fake, baseProps));
    expect(drops(fake).map((s) => s.text)).toEqual([
      buildAtomicDropSql({ name: 'ledger', oid: 30000, owner: 'tim', cascade: false }),
    ]);
    // No bare DROP and no separate emptiness probe reached the server.
    expect(fake.statements.some((s) => s.text.startsWith('DROP SCHEMA'))).toBe(false);
    expect(fake.statements.some((s) => s.text.includes('AS empty'))).toBe(false);
    expect(fake.schemas.get('ledger')).toBeUndefined();
  });

  test('the block locks BEFORE it re-verifies, re-verifies oid + owner, and drops last', () => {
    const sql = buildAtomicDropSql({ name: 'ledger', oid: 30000, owner: 'tim', cascade: false });
    const at = (needle: string): number => sql.indexOf(needle);
    expect(at('pg_advisory_xact_lock')).toBeGreaterThan(-1);
    expect(at('pg_advisory_xact_lock')).toBeLessThan(at('n.oid = v_oid'));
    expect(at('pg_get_userbyid(n.nspowner) = v_owner')).toBeGreaterThan(-1);
    expect(at('n.oid = v_oid')).toBeLessThan(at('EXECUTE'));
  });

  test('a schema replaced between the read and the drop is refused, nothing dropped (HF001)', async () => {
    const fake = makeFakeSql({ schemas: [liveRow()] });
    // The read sees oid 30000; before the DO runs another role drops and recreates the name.
    const racing: PgExecutor = {
      ...fake,
      unsafe: (text, params) => {
        if (text.startsWith('DO ')) {
          fake.schemas.set('ledger', liveRow({ oid: 30001, owner: 'intruder' }));
        }
        return fake.unsafe(text, params);
      },
    };
    const error = await fails(deleteWithClient(racing, baseProps, liveRow()));
    expect(error).toBeInstanceOf(PostgresSchemaDeleteForeignRefused);
    expect(error).toMatchObject({ liveOid: 30001, liveOwner: 'intruder', lastOid: 30000 });
    expect(fake.schemas.get('ledger')).toMatchObject({ oid: 30001 });
  });

  test('a schema that vanished between the read and the drop is idempotent success', async () => {
    const fake = makeFakeSql({ schemas: [liveRow()] });
    const racing: PgExecutor = {
      ...fake,
      unsafe: (text, params) => {
        if (text.startsWith('DO ')) fake.schemas.delete('ledger');
        return fake.unsafe(text, params);
      },
    };
    await run(dropWithClient(racing, baseProps));
  });
});

describe('drop: emptiness', () => {
  test('refuses a non-empty schema with cascade false (HF002 → typed tag)', async () => {
    const fake = makeFakeSql({ schemas: [liveRow()], schemasWithRelations: ['ledger'] });
    expect(await fails(dropWithClient(fake, baseProps))).toBeInstanceOf(
      PostgresSchemaDropNotEmptyError,
    );
    expect(fake.schemas.get('ledger')).not.toBeUndefined();
  });

  test('drops a non-empty schema with cascade true when nothing outside depends on it', async () => {
    const fake = makeFakeSql({ schemas: [liveRow()], schemasWithRelations: ['ledger'] });
    await run(dropWithClient(fake, { ...baseProps, cascade: true }));
    expect(fake.schemas.get('ledger')).toBeUndefined();
    expect(drops(fake)[0]?.text).toContain(`'DROP SCHEMA IF EXISTS "ledger" CASCADE'`);
  });

  test("the server's own 2BP01 (an object kind the four catalogs miss) is the same typed tag", async () => {
    const refusing: PgExecutor = {
      unsafe: <A extends object>(text: string) =>
        text.startsWith('SELECT current_database()')
          ? Effect.succeed([{ database: 'postgres' }] as unknown as ReadonlyArray<A>)
          : !text.startsWith('DO ') && text.includes('FROM pg_catalog.pg_namespace')
            ? Effect.succeed([liveRow()] as unknown as ReadonlyArray<A>)
            : Effect.fail(
                new SqlError({
                  reason: new UnknownError({
                    cause: Object.assign(new Error('ERROR:  2BP01: dependent objects'), {
                      code: '2BP01',
                    }),
                    message: 'dependent_objects_still_exist',
                    operation: 'DO',
                  }),
                }),
              ),
      transaction: () => Effect.void,
    };
    expect(await fails(dropWithClient(refusing, baseProps))).toBeInstanceOf(
      PostgresSchemaDropNotEmptyError,
    );
  });
});

describe('drop: cascade never reaches another schema', () => {
  test('refuses cascade when objects in other schemas depend on this one — count only (HF003)', async () => {
    const fake = makeFakeSql({
      schemas: [liveRow()],
      schemasWithRelations: ['ledger'],
      dependentsOutside: { ledger: 3 },
    });
    const error = await fails(dropWithClient(fake, { ...baseProps, cascade: true }));
    expect(error).toBeInstanceOf(PostgresSchemaCascadeCrossSchemaRefused);
    expect(error).toMatchObject({ schema: 'ledger', dependents: 3 });
    // The message names a count and this schema — never another owner's object.
    expect((error as Error).message).toContain('3 dependent object(s)');
    expect(fake.schemas.get('ledger')).not.toBeUndefined();
    expect(fake.relationsIn.has('ledger')).toBe(true);
  });

  test('cascade false never runs the dependents check: the emptiness refusal comes first', async () => {
    const fake = makeFakeSql({
      schemas: [liveRow()],
      schemasWithRelations: ['ledger'],
      dependentsOutside: { ledger: 3 },
    });
    expect(await fails(dropWithClient(fake, baseProps))).toBeInstanceOf(
      PostgresSchemaDropNotEmptyError,
    );
  });

  test('the dependents query counts per catalog class and treats an unknown class as foreign', () => {
    const sql = buildAtomicDropSql({ name: 'ledger', oid: 1, owner: 'tim', cascade: true });
    expect(sql).toContain('pg_catalog.pg_depend');
    // A class the CASE does not know yields NULL; IS DISTINCT FROM counts NULL as foreign, so an
    // unclassifiable dependent refuses the cascade instead of slipping through.
    expect(sql).toContain('IS DISTINCT FROM v_ns');
    for (const catalog of [
      'pg_constraint',
      'pg_trigger',
      'pg_rewrite',
      'pg_attrdef',
      'pg_policy',
    ]) {
      // Inside the body's `E'…'` literal every quote is doubled.
      expect(sql).toContain(`''pg_catalog.${catalog}''::pg_catalog.regclass`);
    }
  });
});

describe('drop: the generated text cannot be broken out of by a name', () => {
  test('a schema name holding quotes, backslashes and a dollar-quote tag stays inside its literal', () => {
    const name = `x$$; DROP TABLE t; --'\\"`;
    const sql = buildAtomicDropSql({ name, oid: 1, owner: `o'wn\\er`, cascade: false });
    expect(sql.startsWith("DO E'")).toBe(true);
    expect(sql.endsWith("'")).toBe(true);
    // No unescaped quote before the final one: every `'` inside is doubled by the quoter.
    expect(sql.slice(5, -1).replace(/''/g, '')).not.toContain("'");
  });
});
