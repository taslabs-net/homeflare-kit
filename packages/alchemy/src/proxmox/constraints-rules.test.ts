/**
 * The validator's own rule kinds, each at and past its boundary.
 *
 * ★ SPLIT OUT OF constraints.test.ts FOR THE 250-LINE CAP, and the seam is real: that file is
 *   about the v-r2-offsite INCIDENT and the tables generated from the vendor schema, while this
 *   one is about `violations` as a function — a literal table, a literal form, and no engine.
 *
 * ★ ONE MUTANT PER BRANCH. Each case below fails if that single comparison is deleted, inverted or
 *   its boundary moved by one — which is the only way to know the validator checks what it claims
 *   rather than passing everything.
 */
import { describe, expect, test } from 'bun:test';
import { type EndpointConstraints, refusal, violations } from './constraints.ts';

const VERIFY = 'pbs:POST /config/verify';
const ROCKET = String.fromCodePoint(0x1f680);

describe('every rule kind, at and past its boundary', () => {
  const table: EndpointConstraints = {
    depth: { maximum: 7, minimum: 0, type: 'integer' },
    mode: { enum: ['all', 'any'], type: 'string' },
    name: { maxLength: 4, minLength: 2, pattern: '^[a-z]+$', patternSource: '/^[a-z]+$/' },
    store: { required: true, type: 'string' },
    tags: { maxLength: 3, type: 'string' },
  };
  const at = (form: Record<string, string | readonly string[]>, presence = false) =>
    violations(table, form, { presence });

  test('maxLength: 4 passes, 5 does not', () => {
    expect(at({ name: 'abcd' })).toEqual([]);
    expect(at({ name: 'abcde' })).toEqual(['name: at most 4 characters']);
  });

  test('minLength: 2 passes, 1 does not', () => {
    expect(at({ name: 'ab' })).toEqual([]);
    expect(at({ name: 'a' })).toEqual(['name: at least 2 characters']);
  });

  test('minimum and maximum are inclusive on both sides', () => {
    expect(at({ depth: '0' })).toEqual([]);
    expect(at({ depth: '7' })).toEqual([]);
    expect(at({ depth: '-1' })).toEqual(['depth: at least 0']);
    expect(at({ depth: '8' })).toEqual(['depth: at most 7']);
  });

  test('enum quotes the vendor own members', () => {
    expect(at({ mode: 'any' })).toEqual([]);
    expect(at({ mode: 'ALL' })).toEqual(['mode: must be one of all, any']);
  });

  test('pattern reports the VENDOR spelling, not the translated one', () => {
    expect(at({ name: 'abc' })).toEqual([]);
    expect(at({ name: 'ab1' })).toEqual(['name: must match /^[a-z]+$/']);
  });

  test('required is checked only when presence is asked for — an update form is partial', () => {
    expect(at({})).toEqual([]);
    expect(at({}, true)).toEqual(['store: required']);
    expect(at({ store: 'r2' }, true)).toEqual([]);
  });

  /** ⚠️ Characters, not UTF-16 code units: an astral character is ONE character to Proxmox. */
  test('length counts characters, so an astral character is one', () => {
    expect(at({ tags: `${ROCKET}ab` })).toEqual([]);
    expect(at({ tags: `${ROCKET}abc` })).toEqual(['tags: at most 3 characters']);
  });

  /** ⚠️ A list is repeated keys on the wire (client.ts), so every element faces the same rule. */
  test('every element of an array value is checked', () => {
    expect(at({ tags: ['ab', 'abcd'] })).toEqual(['tags: at most 3 characters']);
  });

  test('a key the table does not mention is not an error', () => {
    expect(at({ unlisted: 'anything at all' })).toEqual([]);
  });

  test('the refusal names the endpoint and points at the generated table', () => {
    expect(refusal(VERIFY, ['comment: at most 128 characters'])).toContain(VERIFY);
    expect(refusal(VERIFY, ['comment: at most 128 characters'])).toContain('generated/constraints');
  });
});
