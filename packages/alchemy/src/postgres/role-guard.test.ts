/**
 * The create must not survive a missing parent, and a membership whose grantor role is gone
 * must fail typed rather than look repaired.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeFakeSql } from './fake-sql.ts';
import { PostgresRoleMembershipUnrepaired, PostgresRoleParentMissing } from './role-errors.ts';
import type { PostgresRoleAttributes, PostgresRoleProps } from './role-attrs.ts';
import { reconcileWithClient } from './role.ts';

const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

const props: PostgresRoleProps = {
  name: 'seat-observability',
  login: true,
  connectionLimit: 10,
  inherit: true,
  memberOf: ['hf_agent'],
};

const live = (): PostgresRoleAttributes => ({
  name: 'seat-observability',
  oid: 20000,
  login: true,
  connectionLimit: 10,
  inherit: true,
  validUntil: null,
  memberOf: ['hf_agent'],
  passwordSeal: '',
});

describe('missing parent and dead grantor', () => {
  test('a missing parent fails typed and issues no CREATE', async () => {
    const fake = makeFakeSql();
    const error = await fails(reconcileWithClient(fake, props));
    expect(error).toBeInstanceOf(PostgresRoleParentMissing);
    expect((error as PostgresRoleParentMissing).parent).toBe('hf_agent');
    expect(fake.statements.some((s) => s.text.startsWith('CREATE'))).toBe(false);
    expect(fake.roleRows.has('seat-observability')).toBe(false);
  });

  test('a GRANT failure inside the create transaction rolls the CREATE back', async () => {
    const fake = makeFakeSql({ roles: ['hf_agent'], failNext: 'GRANT' });
    const error = await fails(reconcileWithClient(fake, props));
    expect(error).not.toBeInstanceOf(PostgresRoleParentMissing);
    expect(fake.roleRows.has('seat-observability')).toBe(false);
    expect(fake.statements.some((s) => s.text.startsWith('CREATE ROLE'))).toBe(true);
  });

  test('a wanted membership whose grantor role is gone fails typed', async () => {
    const fake = makeFakeSql({ roleRows: [live()], roles: ['hf_agent'] });
    fake.memberships.add('seat-observability\0hf_agent\0');
    fake.membershipOptions.set('seat-observability\0hf_agent\0', { admin: true, set: true });
    const error = await fails(reconcileWithClient(fake, props));
    expect(error).toBeInstanceOf(PostgresRoleMembershipUnrepaired);
    expect((error as PostgresRoleMembershipUnrepaired).grantor).toBeNull();
    expect(fake.memberships.has('seat-observability\0hf_agent\0')).toBe(true);
  });
});
