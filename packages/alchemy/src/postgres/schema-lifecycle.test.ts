/**
 * `reconcile`, `read`, and `drop` for `Postgres.Schema` against `fake-sql.ts`'s recording fake.
 * Tests the greenfield create, comment creation, already-present/drift, owner-missing guard,
 * quoting, the safe-drop rules, and the `current_database()` proof every write path runs first.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { SqlError, UnknownError } from 'effect/unstable/sql/SqlError';
import { makeFakeSql } from './fake-sql.ts';
import { type PostgresSchemaAttributes, type PostgresSchemaProps } from './schema-attrs.ts';
import type { PgExecutor } from './database-sql.ts';
import {
  PostgresSchemaCreateVanished,
  PostgresSchemaDrift,
  PostgresSchemaDropNotEmptyError,
  PostgresSchemaExistsRefused,
  PostgresSchemaOwnerMissing,
  PostgresSchemaWrongDatabase,
} from './schema-errors.ts';
import { dropWithClient, readWithClient, reconcileWithClient } from './schema.ts';

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

describe('the current_database() proof', () => {
  test('reconcile refuses a declared database the connection does not answer, before any write', async () => {
    const fake = makeFakeSql({ roles: ['tim'] });
    const error = await fails(reconcileWithClient(fake, { ...baseProps, database: 'agents' }));
    expect(error).toBeInstanceOf(PostgresSchemaWrongDatabase);
    const refusal = error as PostgresSchemaWrongDatabase;
    expect(refusal.declared).toBe('agents');
    expect(refusal.connected).toBe('postgres');
    // The refusal fires before the first pg_namespace read, so nothing but the proof ran.
    expect(fake.statements.some((s) => s.text.includes('FROM pg_namespace'))).toBe(false);
    expect(fake.statements.some((s) => s.text.startsWith('CREATE SCHEMA'))).toBe(false);
  });

  test('drop refuses the same mismatch before any DROP or emptiness check', async () => {
    const fake = makeFakeSql({ schemas: [liveRow()] });
    const error = await fails(dropWithClient(fake, { ...baseProps, database: 'agents' }));
    expect(error).toBeInstanceOf(PostgresSchemaWrongDatabase);
    expect(fake.statements.some((s) => s.text.startsWith('DROP SCHEMA'))).toBe(false);
    expect(fake.schemas.get('ledger')).not.toBeUndefined();
  });

  test('every read row carries the connected database', async () => {
    const fake = makeFakeSql({ schemas: [liveRow()] });
    const row = await run(readWithClient(fake, 'ledger'));
    expect(row?.database).toBe('postgres');
  });
});

describe('reconcile: greenfield', () => {
  test('issues exactly one CREATE SCHEMA with an AUTHORIZATION clause', async () => {
    const fake = makeFakeSql({ roles: ['tim'] });
    const attrs = await run(reconcileWithClient(fake, baseProps));
    expect(attrs.name).toBe('ledger');
    expect(attrs.owner).toBe('tim');
    const creates = fake.statements.filter((s) => s.text.startsWith('CREATE SCHEMA'));
    expect(creates.length).toBe(1);
    expect(creates[0]?.text).toBe('CREATE SCHEMA "ledger" AUTHORIZATION "tim"');
  });

  test('no owner clause falls back to the executing role', async () => {
    const fake = makeFakeSql({ roles: ['postgres'] });
    const attrs = await run(reconcileWithClient(fake, { name: 'plain', database: 'postgres' }));
    expect(attrs.owner).toBe('postgres');
    const create = fake.statements.find((s) => s.text.startsWith('CREATE SCHEMA'));
    expect(create?.text).toBe('CREATE SCHEMA "plain"');
  });

  test('declared comment is issued with a single COMMENT ON SCHEMA statement', async () => {
    const fake = makeFakeSql({ roles: ['tim'] });
    const attrs = await run(reconcileWithClient(fake, { ...baseProps, comment: 'seat ledger' }));
    expect(attrs.comment).toBe('seat ledger');
    const comments = fake.statements.filter((s) => s.text.startsWith('COMMENT ON SCHEMA'));
    expect(comments.length).toBe(1);
    expect(comments[0]?.text).toBe('COMMENT ON SCHEMA "ledger" IS E\'seat ledger\'');
  });

  test('a declared empty comment IS "no comment": no statement issued, no drift later', async () => {
    const fake = makeFakeSql({ roles: ['tim'] });
    const attrs = await run(reconcileWithClient(fake, { ...baseProps, comment: '' }));
    expect(attrs.comment).toBeNull();
    expect(fake.statements.some((s) => s.text.startsWith('COMMENT ON SCHEMA'))).toBe(false);
    // Postgres stores IS E'' as NULL, so a second plan must stay a noop — the permanent drift
    // loop an unnormalized '' used to cause. Reads (the current_database() and schema-row
    // SELECT proofs) always run, so compare write statements only.
    const writeCount = () =>
      fake.statements.filter((s) => !/^\s*(SELECT|WITH)\b/i.test(s.text)).length;
    const writesBefore = writeCount();
    await run(reconcileWithClient(fake, { ...baseProps, comment: '' }, attrs));
    expect(writeCount()).toBe(writesBefore);
  });

  test('refuses before any CREATE when the owner role does not exist', async () => {
    const fake = makeFakeSql({ roles: [] });
    const error = await fails(reconcileWithClient(fake, baseProps));
    expect(error).toBeInstanceOf(PostgresSchemaOwnerMissing);
    expect(fake.statements.some((s) => s.text.startsWith('CREATE SCHEMA'))).toBe(false);
  });

  test("fails with the vanish tag when the create's re-read finds nothing (S10)", async () => {
    const fake = makeFakeSql({ roles: ['tim'], swallowNextCreateSchema: true });
    const error = await fails(reconcileWithClient(fake, baseProps));
    expect(error).toBeInstanceOf(PostgresSchemaCreateVanished);
  });

  test('a concurrent creator that won the IF NOT EXISTS race is refused, not adopted', async () => {
    const fake = makeFakeSql({ roles: ['tim'], raceNextCreateSchema: 'someone-else' });
    const error = await fails(reconcileWithClient(fake, baseProps));
    expect(error._tag).toBe('PostgresSchemaExistsRefused');
  });

  test('hostile names are quoted exactly: embedded quote and a hyphen', async () => {
    const fake = makeFakeSql({ roles: ['tim'] });
    await run(reconcileWithClient(fake, { name: 'a"b-c', database: 'postgres', owner: 'tim' }));
    const create = fake.statements.find((s) => s.text.startsWith('CREATE SCHEMA'));
    expect(create?.text).toBe('CREATE SCHEMA "a""b-c" AUTHORIZATION "tim"');
  });
});

describe('reconcile: already present', () => {
  test('adopted output with no drift records zero write statements', async () => {
    const fake = makeFakeSql({ roles: ['tim'], schemas: [liveRow()] });
    const attrs = await run(reconcileWithClient(fake, baseProps, liveRow()));
    expect(attrs).toEqual(liveRow());
    expect(
      fake.statements.every(
        (s) => !s.text.startsWith('CREATE SCHEMA') && !s.text.startsWith('COMMENT ON SCHEMA'),
      ),
    ).toBe(true);
  });

  test('an owner mismatch fails with the typed drift tag and issues no ALTER', async () => {
    const fake = makeFakeSql({
      roles: ['tim', 'someone-else'],
      schemas: [liveRow({ owner: 'someone-else' })],
    });
    const error = await fails(reconcileWithClient(fake, baseProps, liveRow()));
    expect(error).toBeInstanceOf(PostgresSchemaDrift);
    expect((error as PostgresSchemaDrift).prop).toBe('owner');
    expect(fake.statements.some((s) => s.text.startsWith('ALTER'))).toBe(false);
  });

  test('a comment mismatch fails with the typed drift tag naming "comment"', async () => {
    const fake = makeFakeSql({ roles: ['tim'], schemas: [liveRow({ comment: 'old comment' })] });
    const error = await fails(
      reconcileWithClient(fake, { ...baseProps, comment: 'new comment' }, liveRow()),
    );
    expect(error).toBeInstanceOf(PostgresSchemaDrift);
    expect((error as PostgresSchemaDrift).prop).toBe('comment');
  });

  test('a missing comment declaration does not drift against an existing comment', async () => {
    const fake = makeFakeSql({ roles: ['tim'], schemas: [liveRow({ comment: 'legacy' })] });
    const attrs = await run(reconcileWithClient(fake, baseProps, liveRow()));
    expect(attrs.comment).toBe('legacy');
    expect(fake.statements.some((s) => s.text.startsWith('COMMENT'))).toBe(false);
  });
});

test('pre-existing same-owner schema without output is refused', async () => {
  const fake = makeFakeSql({ schemas: [liveRow()], schemasWithRelations: ['ledger'] });
  const error = await fails(reconcileWithClient(fake, baseProps));
  expect(error).toBeInstanceOf(PostgresSchemaExistsRefused);
  expect(fake.schemas.get('ledger')).toEqual(liveRow());
  expect(fake.relationsIn.has('ledger')).toBe(true);
});

describe('read', () => {
  test('answers undefined when the schema is absent', async () => {
    const fake = makeFakeSql();
    expect(await run(readWithClient(fake, 'ledger'))).toBeUndefined();
  });

  test("answers the live row when present (ownership branding is the caller's job)", async () => {
    const fake = makeFakeSql({ schemas: [liveRow()] });
    expect(await run(readWithClient(fake, 'ledger'))).toEqual(liveRow());
  });
});

describe('drop', () => {
  test('drops an empty schema with cascade false', async () => {
    const fake = makeFakeSql({ schemas: [liveRow()] });
    await run(dropWithClient(fake, baseProps));
    const drops = fake.statements.filter((s) => s.text.startsWith('DROP SCHEMA'));
    expect(drops.length).toBe(1);
    expect(drops[0]?.text).toBe('DROP SCHEMA IF EXISTS "ledger"');
    expect(fake.schemas.get('ledger')).toBeUndefined();
  });

  test('refuses to drop a non-empty schema with cascade false', async () => {
    const fake = makeFakeSql({ schemas: [liveRow()], schemasWithRelations: ['ledger'] });
    const error = await fails(dropWithClient(fake, baseProps));
    expect(error).toBeInstanceOf(PostgresSchemaDropNotEmptyError);
    expect(fake.schemas.get('ledger')).not.toBeUndefined();
  });

  test('drops a non-empty schema with cascade true', async () => {
    const fake = makeFakeSql({ schemas: [liveRow()], schemasWithRelations: ['ledger'] });
    await run(dropWithClient(fake, { ...baseProps, cascade: true }));
    const drop = fake.statements.find((s) => s.text.startsWith('DROP SCHEMA'));
    expect(drop?.text).toBe('DROP SCHEMA IF EXISTS "ledger" CASCADE');
    expect(fake.schemas.get('ledger')).toBeUndefined();
  });

  test('classifies the server 2BP01 refusal as the typed not-empty tag', async () => {
    // The emptiness check said empty, but the server refuses with SQLSTATE 2BP01 — an object
    // kind the check's four catalogs do not cover. Class `2B` is not `42`, so both drivers
    // wrap it as UnknownError with the raw code on the cause; this executor replays that shape.
    const refusing: PgExecutor = {
      unsafe: <A extends object>(text: string) =>
        text.startsWith('SELECT current_database()')
          ? Effect.succeed([{ database: 'postgres' }] as unknown as ReadonlyArray<A>)
          : text.includes('AS empty')
            ? Effect.succeed([{ empty: true }] as unknown as ReadonlyArray<A>)
            : Effect.fail(
                new SqlError({
                  reason: new UnknownError({
                    cause: Object.assign(
                      new Error('ERROR:  2BP01: dependent objects still exist'),
                      { code: '2BP01' },
                    ),
                    message: 'dependent_objects_still_exist',
                    operation: 'DROP SCHEMA',
                  }),
                }),
              ),
      transaction: () => Effect.void,
    };
    const error = await fails(dropWithClient(refusing, baseProps));
    expect(error).toBeInstanceOf(PostgresSchemaDropNotEmptyError);
  });
});
