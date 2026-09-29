/**
 * `reconcile`, `read`, and `drop` for `Postgres.Schema` against `fake-sql.ts`'s recording fake.
 * Tests the greenfield create, comment creation, already-present/drift, owner-missing guard,
 * quoting, and the safe-drop rules.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeFakeSql } from './fake-sql.ts';
import { type PostgresSchemaAttributes, type PostgresSchemaProps } from './schema-attrs.ts';
import {
  PostgresSchemaCreateVanished,
  PostgresSchemaDrift,
  PostgresSchemaDropNotEmptyError,
  PostgresSchemaOwnerMissing,
} from './schema-errors.ts';
import { dropWithClient, readWithClient, reconcileWithClient } from './schema.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

const baseProps: PostgresSchemaProps = { name: 'ledger', owner: 'tim' };

const liveRow = (over: Partial<PostgresSchemaAttributes> = {}): PostgresSchemaAttributes => ({
  name: 'ledger',
  oid: 30000,
  owner: 'tim',
  comment: null,
  ...over,
});

describe('reconcile: greenfield', () => {
  test('issues exactly one CREATE SCHEMA IF NOT EXISTS with an AUTHORIZATION clause', async () => {
    const fake = makeFakeSql({ roles: ['tim'] });
    const attrs = await run(reconcileWithClient(fake, baseProps));
    expect(attrs.name).toBe('ledger');
    expect(attrs.owner).toBe('tim');
    const creates = fake.statements.filter((s) => s.text.startsWith('CREATE SCHEMA'));
    expect(creates.length).toBe(1);
    expect(creates[0]?.text).toBe('CREATE SCHEMA IF NOT EXISTS "ledger" AUTHORIZATION "tim"');
  });

  test('no owner clause falls back to the executing role', async () => {
    const fake = makeFakeSql({ roles: ['postgres'] });
    const attrs = await run(reconcileWithClient(fake, { name: 'plain' }));
    expect(attrs.owner).toBe('postgres');
    const create = fake.statements.find((s) => s.text.startsWith('CREATE SCHEMA'));
    expect(create?.text).toBe('CREATE SCHEMA IF NOT EXISTS "plain"');
  });

  test('declared comment is issued with a single COMMENT ON SCHEMA statement', async () => {
    const fake = makeFakeSql({ roles: ['tim'] });
    const attrs = await run(reconcileWithClient(fake, { ...baseProps, comment: 'seat ledger' }));
    expect(attrs.comment).toBe('seat ledger');
    const comments = fake.statements.filter((s) => s.text.startsWith('COMMENT ON SCHEMA'));
    expect(comments.length).toBe(1);
    expect(comments[0]?.text).toBe('COMMENT ON SCHEMA "ledger" IS \'seat ledger\'');
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

  test('hostile names are quoted exactly: embedded quote and a hyphen', async () => {
    const fake = makeFakeSql({ roles: ['tim'] });
    await run(reconcileWithClient(fake, { name: 'a"b-c', owner: 'tim' }));
    const create = fake.statements.find((s) => s.text.startsWith('CREATE SCHEMA'));
    expect(create?.text).toBe('CREATE SCHEMA IF NOT EXISTS "a""b-c" AUTHORIZATION "tim"');
  });
});

describe('reconcile: already present', () => {
  test('no drift records zero write statements', async () => {
    const fake = makeFakeSql({ roles: ['tim'], schemas: [liveRow()] });
    const attrs = await run(reconcileWithClient(fake, baseProps));
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
    const error = await fails(reconcileWithClient(fake, baseProps));
    expect(error).toBeInstanceOf(PostgresSchemaDrift);
    expect((error as PostgresSchemaDrift).prop).toBe('owner');
    expect(fake.statements.some((s) => s.text.startsWith('ALTER'))).toBe(false);
  });

  test('a comment mismatch fails with the typed drift tag naming "comment"', async () => {
    const fake = makeFakeSql({ roles: ['tim'], schemas: [liveRow({ comment: 'old comment' })] });
    const error = await fails(reconcileWithClient(fake, { ...baseProps, comment: 'new comment' }));
    expect(error).toBeInstanceOf(PostgresSchemaDrift);
    expect((error as PostgresSchemaDrift).prop).toBe('comment');
  });

  test('a missing comment declaration does not drift against an existing comment', async () => {
    const fake = makeFakeSql({ roles: ['tim'], schemas: [liveRow({ comment: 'legacy' })] });
    const attrs = await run(reconcileWithClient(fake, baseProps));
    expect(attrs.comment).toBe('legacy');
    expect(fake.statements.some((s) => s.text.startsWith('COMMENT'))).toBe(false);
  });
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
});
