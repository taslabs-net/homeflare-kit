import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import type { PgExecutor } from './database-sql.ts';
import { makeFakeSql } from './fake-sql.ts';
import { classifyInstalled } from './installed-classifier.ts';
import { diffPostgresRole } from './role-diff.ts';
import { selectRoleMemberships, syncMemberships } from './role-membership-sql.ts';
import { declarationMatches } from './role-sql.ts';
import { readRole, reconcileWithClient } from './role.ts';

const props = {
  name: 'seat',
  login: false,
  inherit: false,
  connectionLimit: -1,
  memberOf: ['parent'],
};
const live = { ...props, oid: 42, validUntil: null, passwordSeal: '' };
const unsafeRow = { parent: 'parent', grantor: 'other', admin: true, set: true, inherit: false };

test.each(['2BP01', '42501'])(
  'unwanted revokes stay committed after repair refusal %s',
  async (code) => {
    const fake = makeFakeSql({ roles: ['parent'], roleRows: [live] });
    const unwanted = 'seat\0unwanted\0postgres';
    const kept = 'seat\0parent\0other';
    fake.memberships.add(unwanted);
    fake.memberships.add(kept);
    fake.membershipOptions.set(kept, unsafeRow);
    const refusal = await classifyInstalled(code);
    const batches: string[][] = [];
    const pg: PgExecutor = {
      unsafe: fake.unsafe,
      transaction: (sqls) => {
        batches.push([...sqls]);
        return sqls.some((sql) => sql.startsWith('REVOKE ADMIN OPTION'))
          ? Effect.fail(refusal)
          : fake.transaction(sqls);
      },
    };
    const error = await Effect.runPromise(
      reconcileWithClient(pg, props, {}).pipe(
        Effect.catchTag('PostgresRoleMembershipUnrepaired', Effect.succeed),
      ),
    );
    expect(error).toMatchObject({
      _tag: 'PostgresRoleMembershipUnrepaired',
      role: 'seat',
      parent: 'parent',
      grantor: 'other',
      declared: true,
    });
    expect(String(error)).toContain('"parent"');
    expect(String(error)).toContain('"other"');
    expect(batches).toEqual([
      ['REVOKE "unwanted" FROM "seat" GRANTED BY "postgres"'],
      [
        'REVOKE ADMIN OPTION FOR "parent" FROM "seat" GRANTED BY "other" RESTRICT',
        'REVOKE SET OPTION FOR "parent" FROM "seat" GRANTED BY "other" RESTRICT',
      ],
    ]);
    expect(fake.memberships.has(unwanted)).toBe(false);
    expect(fake.memberships.has(kept)).toBe(true);
    expect(fake.membershipOptions.get(kept)).toEqual(unsafeRow);
  },
);

test('unrelated socket errors propagate unchanged', async () => {
  const fake = makeFakeSql({ roles: ['parent'] });
  const refusal = await classifyInstalled('42601');
  const pg: PgExecutor = { unsafe: fake.unsafe, transaction: () => Effect.fail(refusal) };
  expect(await Effect.runPromise(Effect.flip(syncMemberships(pg, props, [unsafeRow])))).toBe(
    refusal,
  );
});

test('reads INHERIT and repairs another grantor row for declared NOINHERIT', async () => {
  const fake = makeFakeSql({ roles: ['parent'], roleRows: [live] });
  const key = 'seat\0parent\0other';
  fake.memberships.add(key);
  fake.membershipOptions.set(key, { admin: false, set: false, inherit: true });
  const before = await Effect.runPromise(readRole(fake, 'seat'));
  if (before === undefined) throw new Error('seeded role missing');
  expect(before?.memberships).toEqual([
    { parent: 'parent', grantor: 'other', admin: false, set: false, inherit: true },
  ]);
  expect(
    fake.statements.find((s) => s.text.includes('FROM pg_catalog.pg_auth_members'))?.text,
  ).toContain('m.inherit_option AS inherit');
  expect(await Effect.runPromise(diffPostgresRole(props, live, {}, { found: before }))).toEqual({
    action: 'update',
  });
  expect(declarationMatches(props, before)).toBe(false);
  await Effect.runPromise(reconcileWithClient(fake, props, {}));
  expect(fake.statements.filter((s) => s.text.startsWith('REVOKE')).map((s) => s.text)).toEqual([
    'REVOKE INHERIT OPTION FOR "parent" FROM "seat" GRANTED BY "other" RESTRICT',
  ]);
  expect(fake.memberships.has(key)).toBe(true);
  const after = await Effect.runPromise(readRole(fake, 'seat'));
  if (after === undefined) throw new Error('reconciled role missing');
  expect(after?.memberships?.[0]?.inherit).toBe(false);
  expect(await Effect.runPromise(diffPostgresRole(props, live, {}, { found: after }))).toEqual({
    action: 'noop',
  });
  expect(declarationMatches(props, after)).toBe(true);
});

test('a warning-only INHERIT no-op fails the catalog backstop', async () => {
  const fake = makeFakeSql({ roles: ['parent'] });
  fake.memberships.add('seat\0parent\0other');
  fake.membershipOptions.set('seat\0parent\0other', { admin: false, set: false, inherit: true });
  const rows = await Effect.runPromise(selectRoleMemberships(fake, 'seat'));
  const pg: PgExecutor = { unsafe: fake.unsafe, transaction: () => Effect.void };
  const error = await Effect.runPromise(Effect.flip(syncMemberships(pg, props, rows)));
  expect(error).toMatchObject({
    _tag: 'PostgresRoleMembershipUnrepaired',
    parent: 'parent',
    grantor: 'other',
  });
  // INHERIT TRUE is safe when declared, and omitted memberOf still means not asserted.
  await Effect.runPromise(syncMemberships(pg, { ...props, inherit: true }, rows));
  const { memberOf: _unasserted, ...unasserted } = props;
  await Effect.runPromise(syncMemberships(pg, unasserted, rows));
});

test('ADMIN or SET on the live read answers update; stored membership rows do not', async () => {
  const declared = { ...props, inherit: true };
  const stored = { ...live, inherit: true };
  const row = (admin: boolean, set: boolean) => ({
    found: {
      ...stored,
      memberships: [{ parent: 'parent', grantor: 'postgres', inherit: true, admin, set }],
    },
  });
  expect(await Effect.runPromise(diffPostgresRole(declared, stored, {}, row(true, true)))).toEqual({
    action: 'update',
  });
  expect(await Effect.runPromise(diffPostgresRole(declared, stored, {}, row(false, true)))).toEqual(
    {
      action: 'update',
    },
  );
  expect(
    await Effect.runPromise(diffPostgresRole(declared, stored, {}, row(false, false))),
  ).toEqual({
    action: 'noop',
  });
  const stuffed = {
    ...stored,
    memberships: [{ parent: 'parent', grantor: 'postgres', inherit: true, admin: true, set: true }],
  };
  expect(await Effect.runPromise(diffPostgresRole(declared, stuffed))).toEqual({ action: 'noop' });
});
