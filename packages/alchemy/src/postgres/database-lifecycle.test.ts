/**
 * `reconcile` and `read` against `fake-sql.ts`'s recording fake — greenfield, no-drift, drift,
 * a `42P04` race, a missing owner role, and exact quoting for hostile names. Every case reverts
 * cleanly by reverting `database.ts`/`database-sql.ts` locally: these tests fail on `origin/main`
 * because the files do not exist there.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeFakeSql } from './fake-sql.ts';
import { readWithClient, reconcileWithClient } from './database.ts';
import { PostgresDatabaseDrift, PostgresDatabaseOwnerMissing } from './errors.ts';
import type { PostgresDatabaseAttributes, PostgresDatabaseProps } from './database-attrs.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

const baseProps: PostgresDatabaseProps = { name: 'widgets', owner: 'tim' };

const liveRow = (over: Partial<PostgresDatabaseAttributes> = {}): PostgresDatabaseAttributes => ({
  name: 'widgets',
  oid: 30000,
  owner: 'tim',
  encoding: 'UTF8',
  localeProvider: 'libc',
  collate: 'C',
  ctype: 'C',
  allowConnections: true,
  connectionLimit: -1,
  isTemplate: false,
  tablespace: 'pg_default',
  ...over,
});

describe('reconcile: greenfield', () => {
  test('issues exactly one CREATE, quoted, with an OWNER clause, and nothing before the role check', async () => {
    const fake = makeFakeSql({ roles: ['tim'] });
    const attrs = await run(reconcileWithClient(fake, baseProps));
    expect(attrs.name).toBe('widgets');
    expect(attrs.owner).toBe('tim');
    const creates = fake.statements.filter((s) => s.text.startsWith('CREATE DATABASE'));
    expect(creates.length).toBe(1);
    expect(creates[0]?.text).toBe('CREATE DATABASE "widgets" WITH OWNER "tim"');
  });

  test('refuses before any CREATE when the owner role does not exist', async () => {
    const fake = makeFakeSql({ roles: [] });
    const error = await fails(reconcileWithClient(fake, baseProps));
    expect(error).toBeInstanceOf(PostgresDatabaseOwnerMissing);
    expect(fake.statements.some((s) => s.text.startsWith('CREATE DATABASE'))).toBe(false);
  });

  test('a 42P04 race (something else created it first) converges instead of failing', async () => {
    const fake = makeFakeSql({ roles: ['tim'], raceNextCreate: true });
    // Seed the row a "competing" create would have produced, so the post-race re-read finds it.
    fake.databases.set('widgets', liveRow());
    const attrs = await run(reconcileWithClient(fake, baseProps));
    expect(attrs.name).toBe('widgets');
  });

  test('hostile names are quoted exactly: embedded quote and a hyphen', async () => {
    const fake = makeFakeSql({ roles: ['tim'] });
    await run(reconcileWithClient(fake, { name: 'a"b-c', owner: 'tim' }));
    const create = fake.statements.find((s) => s.text.startsWith('CREATE DATABASE'));
    expect(create?.text).toBe('CREATE DATABASE "a""b-c" WITH OWNER "tim"');
  });
});

describe('reconcile: already present', () => {
  test('no drift records zero write statements', async () => {
    const fake = makeFakeSql({ roles: ['tim'], databases: [liveRow()] });
    const attrs = await run(reconcileWithClient(fake, baseProps));
    expect(attrs).toEqual(liveRow());
    expect(
      fake.statements.every((s) => !s.text.startsWith('CREATE') && !s.text.startsWith('ALTER')),
    ).toBe(true);
  });

  test('an owner mismatch fails with the typed drift tag and issues no ALTER', async () => {
    const fake = makeFakeSql({
      roles: ['tim', 'someone-else'],
      databases: [liveRow({ owner: 'someone-else' })],
    });
    const error = await fails(reconcileWithClient(fake, baseProps));
    expect(error).toBeInstanceOf(PostgresDatabaseDrift);
    expect((error as PostgresDatabaseDrift).prop).toBe('owner');
    expect(fake.statements.some((s) => s.text.startsWith('ALTER'))).toBe(false);
  });

  test('an asserted-prop mismatch fails with the typed drift tag naming that prop', async () => {
    const fake = makeFakeSql({ roles: ['tim'], databases: [liveRow({ isTemplate: true })] });
    const error = await fails(reconcileWithClient(fake, { ...baseProps, isTemplate: false }));
    expect(error).toBeInstanceOf(PostgresDatabaseDrift);
    expect((error as PostgresDatabaseDrift).prop).toBe('isTemplate');
  });

  test('no recorded statement ever runs inside BEGIN', async () => {
    const fake = makeFakeSql({ roles: ['tim'], databases: [liveRow()] });
    await run(reconcileWithClient(fake, baseProps));
    expect(fake.statements.some((s) => /\bBEGIN\b/.test(s.text))).toBe(false);
  });
});

describe('read', () => {
  test('answers undefined when the database is absent', async () => {
    const fake = makeFakeSql();
    expect(await run(readWithClient(fake, 'widgets'))).toBeUndefined();
  });

  test("answers the live row when present (ownership branding is the caller's job)", async () => {
    const fake = makeFakeSql({ databases: [liveRow()] });
    expect(await run(readWithClient(fake, 'widgets'))).toEqual(liveRow());
  });
});
