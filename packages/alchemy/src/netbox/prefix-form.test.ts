/**
 * What an undeclared property means — and the day it meant "delete that".
 *
 * 🔴 THE BUG THIS PINS, FOUND BY REVIEW RATHER THAN BY AN INCIDENT. `Netbox.Prefix` shipped
 *   sending `description: ''` whenever the prop was absent. On a create that is invisible. ⛔ On
 *   an ADOPT it is data loss: NetBox is the estate's record of DECISIONS, and a prefix's
 *   description is usually the only written trace of why that range exists. The first deploy that
 *   adopted one would have PATCHed it to empty, and the plan would have read `update` — a diff
 *   that looks like converging a declaration and is really deleting a sentence.
 *
 * ★ THE TELL WAS THE INCONSISTENCY, not a failure. Foreign keys were already omitted when
 *   undeclared, with a comment saying why; free text was not. Two fields, the same hazard, two
 *   answers — that gap is the defect.
 */
import { describe, expect, test } from 'bun:test';
import { prefixBody, prefixMatches } from './prefix-form.ts';
import type { PrefixAttributes } from './prefix.ts';

const live = (over: Partial<PrefixAttributes> = {}): PrefixAttributes => ({
  comments: '',
  description: '',
  isPool: false,
  markUtilized: false,
  prefix: '10.0.0.0/24',
  prefixId: 1,
  status: 'active',
  tenant: undefined,
  vlan: undefined,
  vrf: undefined,
  ...over,
});

describe('an undeclared field is not an instruction to clear it', () => {
  test('the body omits description and comments entirely when they are absent', () => {
    const body = prefixBody({ prefix: '10.0.0.0/24' });
    expect(Object.hasOwn(body, 'description')).toBe(false);
    expect(Object.hasOwn(body, 'comments')).toBe(false);
  });

  /** ⛔ The regression itself: a prefix carrying a human's note must read as converged. */
  test('a live description nobody declared does NOT count as drift', () => {
    expect(
      prefixMatches(live({ description: 'retired 2026-09-14, do not reuse' }), {
        prefix: '10.0.0.0/24',
      }),
    ).toBe(true);
  });

  test('the same is true of comments and of an optional foreign key', () => {
    const attributes = live({ comments: 'see the retirement doc', tenant: 4, vlan: 9 });
    expect(prefixMatches(attributes, { prefix: '10.0.0.0/24' })).toBe(true);
  });

  /**
   * ⚠️ THE COST, STATED: prose is cleared by declaring it empty, on purpose. That is the readable
   *   way to say a destructive thing, and it still reaches the wire.
   */
  test('an explicitly empty description IS sent and IS compared', () => {
    expect(prefixBody({ description: '', prefix: '10.0.0.0/24' })['description']).toBe('');
    expect(
      prefixMatches(live({ description: 'a note' }), { description: '', prefix: '10.0.0.0/24' }),
    ).toBe(false);
  });
});

describe('a field NetBox itself defaults is still settled', () => {
  /**
   * ★ THE LINE BETWEEN THE TWO GROUPS. `status`, `is_pool` and `mark_utilized` have vendor
   *   defaults in the schema, so omitting one genuinely means "the default" and settling it says
   *   what NetBox would have done anyway. Free text has no such default.
   */
  test('status, is_pool and mark_utilized are always on the wire', () => {
    const body = prefixBody({ prefix: '10.0.0.0/24' });
    expect(body['status']).toBe('active');
    expect(body['is_pool']).toBe(false);
    expect(body['mark_utilized']).toBe(false);
  });

  test('a live status that differs from the settled default IS drift', () => {
    expect(prefixMatches(live({ status: 'reserved' }), { prefix: '10.0.0.0/24' })).toBe(false);
    expect(
      prefixMatches(live({ status: 'reserved' }), {
        prefix: '10.0.0.0/24',
        status: 'reserved',
      }),
    ).toBe(true);
  });

  /** ★ The move this resource exists for: recording a retirement as a declaration. */
  test('declaring deprecated is drift against an active prefix, and converges', () => {
    const props = { prefix: '10.1.1.0/24', status: 'deprecated' } as const;
    expect(prefixMatches(live({ prefix: '10.1.1.0/24' }), props)).toBe(false);
    expect(prefixBody(props)['status']).toBe('deprecated');
    expect(prefixMatches(live({ prefix: '10.1.1.0/24', status: 'deprecated' }), props)).toBe(true);
  });
});

/**
 * ⛔ THE INVARIANT THAT KEEPS THE TWO IN STEP. A field compared but never sent produces a plan
 *   that says `update` forever: the PATCH omits it, so the next read is unchanged.
 */
describe('body and matches agree about which fields are ours', () => {
  test('every field matches compares as optional is one the body sends when declared', () => {
    const declared = prefixBody({
      comments: 'c',
      description: 'd',
      prefix: '10.0.0.0/24',
      tenant: 4,
      vlan: 9,
    });
    for (const key of ['description', 'comments', 'tenant', 'vlan']) {
      expect(Object.hasOwn(declared, key)).toBe(true);
    }
  });

  test('an undeclared optional is neither sent nor compared', () => {
    const bare = prefixBody({ prefix: '10.0.0.0/24' });
    for (const key of ['description', 'comments', 'tenant', 'vlan', 'vrf']) {
      expect(Object.hasOwn(bare, key)).toBe(false);
    }
    expect(
      prefixMatches(live({ comments: 'x', description: 'y', tenant: 1, vlan: 2 }), {
        prefix: '10.0.0.0/24',
      }),
    ).toBe(true);
  });
});
