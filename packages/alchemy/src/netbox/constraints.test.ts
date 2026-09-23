/**
 * The constraint reader over a JSON body — and the four ways a naive one gets it wrong.
 *
 * ★ EVERY RULE EXERCISED HERE COMES FROM THE GENERATED TABLE, not a literal invented in this
 *   file, wherever a real endpoint states it. A test that made up its own `maxLength` would pass
 *   forever while the committed table said something else.
 */
import { describe, expect, test } from 'bun:test';
import { bodyViolations, constraintsFor } from './constraint-guard.ts';
import { violations } from './constraints.ts';

const CREATE = 'netbox:POST /api/ipam/prefixes/';
const UPDATE = 'netbox:PATCH /api/ipam/prefixes/{id}/';

describe('the generated table is the one being read', () => {
  test('the prefix create table carries NetBox 4.7.0 own rules', () => {
    const table = constraintsFor(CREATE);
    expect(table['prefix']?.required).toBe(true);
    expect(table['description']?.maxLength).toBe(200);
    expect(table['status']?.enum).toEqual(['container', 'active', 'reserved', 'deprecated']);
  });

  /** ⛔ An unknown key is a defect: the tables were not regenerated, and silence would hide it. */
  test('an endpoint nobody generated throws rather than passing everything', () => {
    expect(() => constraintsFor('netbox:POST /api/dcim/devices/')).toThrow(
      /no vendor constraint table/,
    );
  });
});

describe('what it refuses', () => {
  test('a description one character over the vendor limit', () => {
    const found = bodyViolations(
      CREATE,
      { description: 'x'.repeat(201), prefix: '10.0.0.0/24' },
      true,
    );
    expect(found).toEqual(['description: at most 200 characters']);
  });

  test('exactly the limit is accepted', () => {
    expect(
      bodyViolations(CREATE, { description: 'x'.repeat(200), prefix: '10.0.0.0/24' }, true),
    ).toEqual([]);
  });

  /**
   * ⚠️ `[...value].length`, NOT `value.length`. An emoji is two UTF-16 code units and ONE
   *   character; Django counts characters. Counting code units would refuse a description NetBox
   *   accepts — rejecting a legal value at plan time being the failure worse than the 400.
   */
  test('a 200-character description made of astral characters is accepted', () => {
    const found = bodyViolations(
      CREATE,
      { description: '🌐'.repeat(200), prefix: '10.0.0.0/24' },
      true,
    );
    expect(found).toEqual([]);
  });

  test('a status outside the vendor enum', () => {
    const found = bodyViolations(CREATE, { prefix: '10.0.0.0/24', status: 'retired' }, true);
    expect(found).toEqual(['status: must be one of container, active, reserved, deprecated']);
  });
});

describe('presence is a create-only rule', () => {
  /** ⛔ A PATCH is deliberately partial; requiring presence would refuse every ordinary edit. */
  test('a missing required property is refused on create and allowed on update', () => {
    expect(bodyViolations(CREATE, { status: 'active' }, true)).toEqual(['prefix: required']);
    expect(bodyViolations(UPDATE, { status: 'active' }, false)).toEqual([]);
  });

  /**
   * ⚠️ `null` IS A VALUE, NOT AN ABSENCE. NetBox clears a nullable foreign key with an explicit
   *   null, so a presence check that used `value === undefined` would call it missing.
   */
  test('an explicit null satisfies presence and trips no string rule', () => {
    expect(bodyViolations(CREATE, { prefix: null }, true)).toEqual([]);
  });
});

describe('a JSON body is not a form, and that changes the checks', () => {
  /**
   * ⛔ THE REASON THIS READER IS NOT THE PROXMOX ONE. `Number(false)` is 0, so a body that
   *   coerced its values would pass a boolean straight through a `minimum: 0` and report nothing.
   */
  test('a boolean is never coerced into a numeric bound', () => {
    const table = { count: { minimum: 1, type: 'integer' } } as const;
    expect(violations(table, { count: false })).toEqual([]);
    expect(violations(table, { count: 0 })).toEqual(['count: at least 1']);
  });

  test('an empty string is not treated as zero', () => {
    const table = { count: { minimum: 0, type: 'integer' } } as const;
    expect(violations(table, { count: '' })).toEqual([]);
  });

  /** ⚠️ An array is a repeated value — tags and every many-to-many — so each element is checked. */
  test('every element of an array faces the same rule', () => {
    const table = { names: { maxLength: 3, type: 'string' } } as const;
    expect(violations(table, { names: ['ok', 'toolong', 'alsotoolong'] })).toEqual([
      'names: at most 3 characters',
      'names: at most 3 characters',
    ]);
  });

  /** ⚠️ The table carries the CONSTRAINED properties, not every property. */
  test('a key the table does not mention is not an error', () => {
    expect(bodyViolations(CREATE, { prefix: '10.0.0.0/24', vrf: 4, whatever: 'x' }, true)).toEqual(
      [],
    );
  });
});
