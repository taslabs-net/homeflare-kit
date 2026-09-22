/**
 * Read-versus-write asymmetry — the bug that makes a resource never converge.
 *
 * 🔴 THE SHAPE IS DIFFERENT IN EACH DIRECTION AND NOTHING IN THE TYPES SAYS SO. Measured in the
 *   NetBox 4.7.0 document: a prefix is WRITTEN with `status: "active"` and READ BACK as
 *   `status: {value: "active", label: "Active"}`; a foreign key is written as `4` and read back
 *   as `{id: 4, url: …, display: …}`. A `matches` that compared those directly would report drift
 *   on every plan, for every object, forever — and each "update" would PATCH the same value back.
 */
import { describe, expect, test } from 'bun:test';
import { bool, choice, fk, text } from './values.ts';

describe('a choice field reads back as an object', () => {
  test('the object form reduces to the string a declaration writes', () => {
    expect(choice({ label: 'Active', value: 'active' })).toBe('active');
  });

  /** ⚠️ Both directions must work: a fixture or a brief serialisation gives the bare string. */
  test('the bare string passes through unchanged', () => {
    expect(choice('deprecated')).toBe('deprecated');
  });

  test('anything else is empty rather than undefined, so a comparison stays total', () => {
    expect(choice(undefined)).toBe('');
    expect(choice(null)).toBe('');
    expect(choice({ label: 'Active' })).toBe('');
  });
});

describe('a foreign key reads back as a nested object', () => {
  test('the nested object reduces to its id', () => {
    expect(
      fk({ display: 'HomeFlare', id: 4, url: 'https://example.invalid/api/tenancy/tenants/4/' }),
    ).toBe(4);
  });

  test('the bare integer passes through', () => {
    expect(fk(7)).toBe(7);
  });

  /**
   * ⛔ `undefined`, NOT `0`. A cleared foreign key and "tenant 0" are different facts, and zero
   *   is falsy — a `matches` written against it would treat an unset tenant as a match for every
   *   declaration that omitted one.
   */
  test('an absent or unrecognisable key is undefined', () => {
    expect(fk(null)).toBeUndefined();
    expect(fk(undefined)).toBeUndefined();
    expect(fk({ display: 'no id here' })).toBeUndefined();
  });
});

describe('text and booleans', () => {
  /** ⚠️ NetBox stores an empty string for absent text, never null — so `''` is the settled value. */
  test('absent text settles to the empty string', () => {
    expect(text(undefined)).toBe('');
    expect(text(null)).toBe('');
    expect(text('a note')).toBe('a note');
  });

  test('only a real true is true', () => {
    expect(bool(true)).toBe(true);
    expect(bool('true')).toBe(false);
    expect(bool(1)).toBe(false);
  });
});
