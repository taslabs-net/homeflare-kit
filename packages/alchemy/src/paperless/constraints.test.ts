/**
 * The generated Paperless constraint tables, exercised at the boundary a plan actually checks:
 * `bodyViolations` against the real generated data, not a literal table constructed by hand.
 *
 * ⛔ THESE TESTS FAIL WITHOUT THE UNIT. Before `codegen/paperless.ts` and `generated/constraints/`
 *   existed, `constraintsFor('paperless:POST /api/tags/')` threw "no vendor constraint table" —
 *   there was nothing to import.
 */
import { describe, expect, test } from 'bun:test';
import { bodyViolations, constraintsFor } from './constraint-guard.ts';

const CREATE = 'paperless:POST /api/tags/';

describe('a 129-character name is refused, a 128-character one is not', () => {
  test('129 plain characters', () => {
    const found = bodyViolations(CREATE, { name: 'a'.repeat(129) }, true);
    expect(found.some((f) => f.includes('name'))).toBe(true);
  });

  /** ⚠️ Counts CHARACTERS, not UTF-16 units — an astral emoji is one character to Django. */
  test('128 astral characters (each a surrogate pair) passes the length check', () => {
    const found = bodyViolations(CREATE, { name: '😀'.repeat(128) }, true);
    expect(found.some((f) => f.includes('name'))).toBe(false);
  });

  test('129 astral characters is refused', () => {
    const found = bodyViolations(CREATE, { name: '😀'.repeat(129) }, true);
    expect(found.some((f) => f.includes('name'))).toBe(true);
  });
});

describe('a 256-plus character match is refused', () => {
  test('256 characters passes, 257 does not', () => {
    expect(bodyViolations(CREATE, { match: 'a'.repeat(256), name: 'x' }, false)).toEqual([]);
    const found = bodyViolations(CREATE, { match: 'a'.repeat(257), name: 'x' }, false);
    expect(found.some((f) => f.includes('match'))).toBe(true);
  });
});

describe('presence is create-only', () => {
  test('a missing required name is refused on create', () => {
    expect(bodyViolations(CREATE, {}, true).some((f) => f.includes('required'))).toBe(true);
  });

  /** ⚠️ An update is PATCH, deliberately partial — presence must not fire without `presence: true`. */
  test('the same missing name is not refused on update', () => {
    expect(bodyViolations(CREATE, {}, false)).toEqual([]);
  });
});

describe('null is a value, not an absence', () => {
  test('an explicit null owner on a table that carries no owner rule violates nothing', () => {
    expect(bodyViolations(CREATE, { name: 'x', owner: null }, true)).toEqual([]);
  });
});

describe('every generated table is reachable and carries its provenance', () => {
  test('all four create endpoints resolve to a non-empty table', () => {
    for (const key of [
      'paperless:POST /api/tags/',
      'paperless:POST /api/document_types/',
      'paperless:POST /api/storage_paths/',
      'paperless:POST /api/custom_fields/',
    ]) {
      expect(Object.keys(constraintsFor(key)).length).toBeGreaterThan(0);
    }
  });

  test('an unknown key names the refresh command rather than silently enforcing nothing', () => {
    expect(() => constraintsFor('paperless:POST /api/never/')).toThrow(
      /bun codegen\/paperless\.ts/,
    );
  });
});
