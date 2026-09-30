/**
 * `reconcile`, `read` and the drop statement against `fake-sql.ts`'s recording fake — greenfield
 * create with exact statement text, membership `GRANT`/`REVOKE`, per-field scalar drift, a create
 * whose re-read finds nothing, and zero statements when nothing drifted. The password lifecycle
 * is `role-password.test.ts`; the plan-time refusals are `role-refusals.test.ts`. Every case
 * reverts cleanly by reverting `role.ts`/`role-sql.ts`/`fake-sql.ts` locally: these fail on
 * `origin/main`, which has none of them.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import type { PgExecutor } from './database-sql.ts';
import { makeFakeSql } from './fake-sql.ts';
import { PostgresRoleCreateVanished } from './role-errors.ts';
import type { PostgresRoleAttributes, PostgresRoleProps } from './role-attrs.ts';
import { readRole, reconcileWithClient } from './role.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

const baseProps: PostgresRoleProps = {
  name: 'seat-observability',
  login: false,
  connectionLimit: 10,
  inherit: true,
};

const liveRole = (over: Partial<PostgresRoleAttributes> = {}): PostgresRoleAttributes => ({
  name: 'seat-observability',
  oid: 20000,
  login: false,
  connectionLimit: 10,
  inherit: true,
  validUntil: null,
  memberOf: [],
  passwordSeal: '',
  ...over,
});

const startingWith = (fake: ReturnType<typeof makeFakeSql>, prefix: string) =>
  fake.statements.filter((s) => s.text.startsWith(prefix));

const writeStatements = (fake: ReturnType<typeof makeFakeSql>) =>
  fake.statements.filter(
    (s) =>
      s.text.startsWith('CREATE') ||
      s.text.startsWith('ALTER') ||
      s.text.startsWith('GRANT') ||
      s.text.startsWith('REVOKE') ||
      s.text.startsWith('DROP'),
  );

describe('reconcile: greenfield', () => {
  test('issues exactly one CREATE with the seat shape, and nothing else', async () => {
    const fake = makeFakeSql();
    const attrs = await run(reconcileWithClient(fake, baseProps));
    expect(attrs.name).toBe('seat-observability');
    expect(startingWith(fake, 'CREATE ROLE')).toEqual([
      {
        text: 'CREATE ROLE "seat-observability" WITH NOLOGIN INHERIT CONNECTION LIMIT 10',
        params: [],
      },
    ]);
    expect(writeStatements(fake).length).toBe(1);
  });

  test('a LOGIN role with an expiry carries VALID UNTIL last, quoted', async () => {
    const fake = makeFakeSql();
    const props = {
      name: 'seat-alice',
      login: true,
      connectionLimit: 10,
      inherit: true,
      validUntil: '2027-01-01T00:00:00Z',
    };
    const attrs = await run(reconcileWithClient(fake, props));
    expect(attrs.validUntil).toBe('2027-01-01T00:00:00Z');
    expect(startingWith(fake, 'CREATE ROLE')[0]?.text).toBe(
      'CREATE ROLE "seat-alice" WITH LOGIN INHERIT CONNECTION LIMIT 10 VALID UNTIL \'2027-01-01T00:00:00Z\'',
    );
  });

  test('declared memberships become one-parent GRANTs after the CREATE, and the answer comes from the re-read, sorted', async () => {
    const fake = makeFakeSql();
    const attrs = await run(
      reconcileWithClient(fake, { ...baseProps, memberOf: ['seat-b', 'hf_agent'] }),
    );
    expect(startingWith(fake, 'GRANT')).toEqual([
      { text: 'GRANT "hf_agent" TO "seat-observability" WITH SET FALSE', params: [] },
      { text: 'GRANT "seat-b" TO "seat-observability" WITH SET FALSE', params: [] },
    ]);
    expect(attrs.memberOf).toEqual(['hf_agent', 'seat-b']);
  });

  test('a hostile role name survives the round trip through the fake\u2019s own catalog', async () => {
    const fake = makeFakeSql();
    const attrs = await run(reconcileWithClient(fake, { ...baseProps, name: 'a"b-c' }));
    expect(attrs.name).toBe('a"b-c');
    expect(startingWith(fake, 'CREATE ROLE')[0]?.text).toBe(
      'CREATE ROLE "a""b-c" WITH NOLOGIN INHERIT CONNECTION LIMIT 10',
    );
  });

  test('a create whose re-read finds nothing fails with the typed tag, not a guess (S10/S20)', async () => {
    const blankPg: PgExecutor = {
      unsafe: <A extends object>() => Effect.succeed([] as ReadonlyArray<A>),
    };
    const error = await fails(reconcileWithClient(blankPg, baseProps));
    expect(error).toBeInstanceOf(PostgresRoleCreateVanished);
  });
});

describe('reconcile: already present', () => {
  test('no drift issues zero write statements and returns the live row', async () => {
    const fake = makeFakeSql({ roleRows: [liveRole()] });
    const attrs = await run(reconcileWithClient(fake, baseProps));
    expect(attrs).toEqual(liveRole());
    expect(writeStatements(fake).length).toBe(0);
  });

  test('scalar drift issues exactly one ALTER per drifted field, in the compared order', async () => {
    const fake = makeFakeSql({
      roleRows: [
        liveRole({
          login: true,
          inherit: false,
          connectionLimit: 1,
          validUntil: '2026-01-01T00:00:00.000Z',
        }),
      ],
    });
    const props = {
      ...baseProps,
      login: false,
      inherit: true,
      connectionLimit: 10,
      validUntil: '2027-01-01T00:00:00Z',
    };
    const attrs = await run(reconcileWithClient(fake, props));
    expect(startingWith(fake, 'ALTER ROLE').map((s) => s.text)).toEqual([
      'ALTER ROLE "seat-observability" WITH NOLOGIN',
      'ALTER ROLE "seat-observability" WITH INHERIT',
      'ALTER ROLE "seat-observability" WITH CONNECTION LIMIT 10',
      'ALTER ROLE "seat-observability" WITH VALID UNTIL \'2027-01-01T00:00:00Z\'',
    ]);
    expect(attrs.connectionLimit).toBe(10);
  });

  test('a validUntil the server serialised with milliseconds is the same instant, so no ALTER', async () => {
    const fake = makeFakeSql({
      roleRows: [liveRole({ validUntil: '2027-01-01T00:00:00.000Z' })],
    });
    await run(reconcileWithClient(fake, { ...baseProps, validUntil: '2027-01-01T00:00:00Z' }));
    expect(fake.statements.some((s) => s.text.startsWith('ALTER'))).toBe(false);
  });

  test('a membership the declaration adds is granted; a live one it drops is revoked', async () => {
    const fake = makeFakeSql({ roleRows: [liveRole()] });
    fake.memberships.add('seat-observability\0hf_agent');
    const attrs = await run(reconcileWithClient(fake, { ...baseProps, memberOf: ['seat-owners'] }));
    expect(startingWith(fake, 'GRANT').map((s) => s.text)).toEqual([
      'GRANT "seat-owners" TO "seat-observability" WITH SET FALSE',
    ]);
    expect(startingWith(fake, 'REVOKE').map((s) => s.text)).toEqual([
      'REVOKE "hf_agent" FROM "seat-observability"',
    ]);
    expect(attrs.memberOf).toEqual(['seat-owners']);
  });

  test('memberOf [] revokes everything; memberOf undefined touches nothing', async () => {
    const revoking = makeFakeSql({ roleRows: [liveRole()] });
    revoking.memberships.add('seat-observability\0hf_agent');
    const afterRevoke = await run(reconcileWithClient(revoking, { ...baseProps, memberOf: [] }));
    expect(afterRevoke.memberOf).toEqual([]);

    const untouched = makeFakeSql({ roleRows: [liveRole()] });
    untouched.memberships.add('seat-observability\0hf_agent');
    const afterNoop = await run(reconcileWithClient(untouched, baseProps));
    expect(afterNoop.memberOf).toEqual(['hf_agent']);
    expect(
      untouched.statements.some((s) => s.text.startsWith('GRANT') || s.text.startsWith('REVOKE')),
    ).toBe(false);
  });
});

describe('read', () => {
  test('answers undefined when the role is absent', async () => {
    const fake = makeFakeSql();
    expect(await run(readRole(fake, 'seat-observability'))).toBeUndefined();
  });

  test('answers the live row with memberships merged in, sorted \u2014 no seal; branding and the seal merge are the caller\u2019s job', async () => {
    const fake = makeFakeSql({ roleRows: [liveRole()] });
    fake.memberships.add('seat-observability\0seat-b');
    fake.memberships.add('seat-observability\0hf_agent');
    expect(await run(readRole(fake, 'seat-observability'))).toEqual({
      name: 'seat-observability',
      oid: 20000,
      login: false,
      connectionLimit: 10,
      inherit: true,
      validUntil: null,
      memberOf: ['hf_agent', 'seat-b'],
      memberships: [
        { parent: 'hf_agent', admin: false, set: false },
        { parent: 'seat-b', admin: false, set: false },
      ],
    });
  });
});

describe('delete statement', () => {
  test('is the idempotent quoted DROP, and the fake applies it to the row and touching memberships', async () => {
    const fake = makeFakeSql({ roleRows: [liveRole()] });
    fake.memberships.add('seat-observability\0hf_agent');
    fake.memberships.add('other-role\0seat-observability');
    await run(fake.unsafe('DROP ROLE IF EXISTS "seat-observability"').pipe(Effect.asVoid));
    expect(fake.roleRows.has('seat-observability')).toBe(false);
    expect(fake.memberships.has('seat-observability\0hf_agent')).toBe(false);
    expect(fake.memberships.has('other-role\0seat-observability')).toBe(false);
    // Idempotent: the same statement against the now-absent role is not an error.
    await run(fake.unsafe('DROP ROLE IF EXISTS "seat-observability"').pipe(Effect.asVoid));
  });
});
