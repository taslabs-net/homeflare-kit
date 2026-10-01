/**
 * Adopt and alter of a role that already carries privileges this family never declares.
 *
 * The review of PR 336: `--adopt` of a SUPERUSER (or CREATEROLE / CREATEDB / REPLICATION /
 * BYPASSRLS) role planned green and left the flag set, and a membership already granted
 * `WITH ADMIN` matched by name so it was never revoked. `GRANT` also omitted `SET`, which
 * upstream defaults to TRUE — a member can `SET ROLE` to the parent.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeFakeSql } from './fake-sql.ts';
import { PostgresRolePrivilegedRefused } from './role-errors.ts';
import type { PostgresRoleAttributes, PostgresRoleProps } from './role-attrs.ts';
import { reconcileWithClient } from './role.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

const baseProps: PostgresRoleProps = {
  name: 'seat-widget',
  login: false,
  connectionLimit: -1,
  inherit: true,
  memberOf: ['hf_agent'],
};

const liveRole = (over: Partial<PostgresRoleAttributes> = {}): PostgresRoleAttributes => ({
  name: 'seat-widget',
  oid: 20000,
  login: false,
  connectionLimit: -1,
  inherit: true,
  validUntil: null,
  memberOf: ['hf_agent'],
  passwordSeal: '',
  superuser: false,
  createrole: false,
  createdb: false,
  replication: false,
  bypassrls: false,
  ...over,
});

describe('adopted privilege flags', () => {
  test('a live SUPERUSER is refused before any write', async () => {
    const fake = makeFakeSql({ roleRows: [liveRole({ superuser: true })] });
    const error = await fails(reconcileWithClient(fake, baseProps));
    expect(error).toBeInstanceOf(PostgresRolePrivilegedRefused);
    expect(
      fake.statements.some((s) => s.text.startsWith('ALTER') || s.text.startsWith('GRANT')),
    ).toBe(false);
  });

  test('a membership granted WITH ADMIN by this session is repaired in place', async () => {
    const fake = makeFakeSql({ roleRows: [liveRole()], roles: ['hf_agent'] });
    fake.memberships.add('seat-widget\0hf_agent\0postgres');
    fake.membershipOptions.set('seat-widget\0hf_agent\0postgres', { admin: true, set: true });
    await run(reconcileWithClient(fake, baseProps));
    const texts = fake.statements.map((s) => s.text);
    // `AddRoleMems` updates the session grantor's row. One full-options GRANT clears ADMIN
    // and SET without a REVOKE that would drop the membership the declaration still wants.
    expect(texts).toContain('GRANT "hf_agent" TO "seat-widget" WITH ADMIN FALSE, SET FALSE');
    expect(texts.some((text) => text.startsWith('REVOKE'))).toBe(false);
    expect(fake.memberships.has('seat-widget\0hf_agent\0postgres')).toBe(true);
    expect(fake.membershipOptions.has('seat-widget\0hf_agent\0postgres')).toBe(false);
  });

  test("another grantor's ADMIN row is revoked by that grantor and the seat grant remains", async () => {
    const fake = makeFakeSql({ roleRows: [liveRole()], roles: ['hf_agent'] });
    fake.memberships.add('seat-widget\0hf_agent\0other');
    fake.membershipOptions.set('seat-widget\0hf_agent\0other', { admin: true, set: true });
    await run(reconcileWithClient(fake, baseProps));
    const texts = fake.statements.map((s) => s.text);
    expect(texts).toContain('GRANT "hf_agent" TO "seat-widget" WITH ADMIN FALSE, SET FALSE');
    expect(texts).toContain('REVOKE "hf_agent" FROM "seat-widget" GRANTED BY "other"');
    expect(fake.memberships.has('seat-widget\0hf_agent\0other')).toBe(false);
    expect(fake.memberships.has('seat-widget\0hf_agent\0postgres')).toBe(true);
    expect(fake.membershipOptions.has('seat-widget\0hf_agent\0postgres')).toBe(false);
  });
});
