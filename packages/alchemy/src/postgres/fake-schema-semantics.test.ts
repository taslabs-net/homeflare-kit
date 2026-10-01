import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeFakeSql } from './fake-sql.ts';

const row = { name: 'ledger', database: 'postgres', owner: 'old_owner', oid: 42, comment: 'keep' };

test('PG18 IF NOT EXISTS preserves oid, owner, comment and contents', async () => {
  const fake = makeFakeSql({ schemas: [row], schemasWithRelations: ['ledger'] });
  await Effect.runPromise(
    fake.unsafe('CREATE SCHEMA IF NOT EXISTS "ledger" AUTHORIZATION "new_owner"'),
  );
  expect(fake.schemas.get('ledger')).toEqual(row);
  expect(fake.relationsIn.has('ledger')).toBe(true);
});

test('PG18 plain CREATE on an existing schema raises 42P06', async () => {
  const fake = makeFakeSql({ schemas: [row] });
  const error = await Effect.runPromise(Effect.flip(fake.unsafe('CREATE SCHEMA "ledger"')));
  expect(error.reason.cause).toMatchObject({ code: '42P06' });
  expect(fake.schemas.get('ledger')).toEqual(row);
});

test('PG18 nonempty DROP without CASCADE raises 2BP01 without deleting anything', async () => {
  const fake = makeFakeSql({ schemas: [row], schemasWithRelations: ['ledger'] });
  const error = await Effect.runPromise(Effect.flip(fake.unsafe('DROP SCHEMA IF EXISTS "ledger"')));
  expect(error.reason.cause).toMatchObject({ code: '2BP01' });
  expect(fake.schemas.get('ledger')).toEqual(row);
  expect(fake.relationsIn.has('ledger')).toBe(true);
});

test('PG18 bootstrap seeds public owned by pg_database_owner', () => {
  expect(makeFakeSql().schemas.get('public')).toMatchObject({
    oid: 2200,
    owner: 'pg_database_owner',
  });
});
