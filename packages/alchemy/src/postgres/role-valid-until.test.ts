/**
 * Plan-time `validUntil` refusals and the instant compare, extracted from
 * `role-refusals.test.ts` so that file stays under the house 250-line cap.
 *
 * A zone suffix is not a timestamp. `2027-13-01T00:00:00Z` and `not-a-dateZ` match the offset
 * regex and `Date.parse` to NaN; a plan that accepts them sends a `VALID UNTIL` PostgreSQL
 * rejects, or one that never compares equal on read-back, so every later reconcile re-issues
 * the same `ALTER`.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { sameValidUntil, validUntilRefusal } from './role-attrs.ts';
import type { PostgresRoleAttributes, PostgresRoleProps } from './role-attrs.ts';
import { PostgresRoleValidUntilRefused } from './role-errors.ts';
import { diffPostgresRole, refuseAtPlan } from './role.ts';

const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

const base: PostgresRoleProps = {
  name: 'seat-observability',
  login: false,
  connectionLimit: 10,
  inherit: true,
};

const output: PostgresRoleAttributes = {
  name: 'seat-observability',
  oid: 20000,
  login: false,
  connectionLimit: 10,
  inherit: true,
  validUntil: null,
  memberOf: [],
  passwordSeal: '',
};

describe('validUntil', () => {
  test('a zone-carrying value passes; a zone-free or unparseable one is refused with its reason', () => {
    expect(validUntilRefusal('2027-01-01T00:00:00Z')).toBeUndefined();
    expect(validUntilRefusal('2027-01-01T02:00:00+02:00')).toBeUndefined();
    expect(validUntilRefusal('2027-01-01T00:00:00')).toEqual({ reason: 'zone-free' });
    expect(validUntilRefusal('2027-01-01')).toEqual({ reason: 'zone-free' });
    expect(validUntilRefusal('not a timestamp')).toEqual({ reason: 'unparseable' });
    // A zone suffix is not enough: Date.parse of these is NaN, and a plan that accepts them
    // sends a VALID UNTIL PostgreSQL rejects or that never compares equal on read-back.
    expect(validUntilRefusal('2027-13-01T00:00:00Z')).toEqual({ reason: 'unparseable' });
    expect(validUntilRefusal('not-a-dateZ')).toEqual({ reason: 'unparseable' });
  });

  test('refuseAtPlan raises the typed tag for a zone-free value', async () => {
    const error = await fails(refuseAtPlan({ ...base, validUntil: '2027-01-01' }));
    expect(error).toBeInstanceOf(PostgresRoleValidUntilRefused);
    expect((error as PostgresRoleValidUntilRefused).reason).toBe('zone-free');
  });

  test('diff refuses the same values, so reconcile and diff can never disagree', async () => {
    const error = await fails(diffPostgresRole({ ...base, validUntil: '2027-01-01' }, output));
    expect(error).toBeInstanceOf(PostgresRoleValidUntilRefused);
  });

  test('sameValidUntil compares instants, so the server’s milliseconds never churn a plan', () => {
    expect(sameValidUntil('2027-01-01T00:00:00Z', '2027-01-01T00:00:00.000Z')).toBe(true);
    expect(sameValidUntil('2027-01-01T02:00:00+02:00', '2027-01-01T00:00:00.000Z')).toBe(true);
    expect(sameValidUntil('2027-01-01T00:00:00Z', null)).toBe(false);
    expect(sameValidUntil('2027-01-01T00:00:00Z', '2028-01-01T00:00:00.000Z')).toBe(false);
  });
});
