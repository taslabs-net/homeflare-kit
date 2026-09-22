/**
 * The Django pattern dialect, and the one class of rule that must NOT be carried over.
 *
 * 🔴 THIS IS THE TEST FOR THE FAILURE THAT WOULD BE INVISIBLE. A pattern copied verbatim from
 *   NetBox compiles cleanly in JavaScript and then means something NARROWER, because Python's
 *   `\w` matches Unicode letters on a `str` and JavaScript's does not. The symptom is a plan that
 *   refuses a slug NetBox would have accepted, blaming the operator for a legal value — which is
 *   strictly worse than the server-side 400 the constraint table exists to replace.
 */
import { describe, expect, test } from 'bun:test';
import { patternRule } from '../codegen/param-rules.ts';
import { translateDjangoPattern } from '../codegen/py-pattern.ts';

describe('ASCII patterns carry over untouched', () => {
  /** ⚠️ The three NetBox 4.7.0 patterns that are already valid, ASCII-only JavaScript. */
  test.each([
    ['^[-a-zA-Z0-9_]+$', 'slug on most models'],
    ['^[0-9a-f]{6}$', 'color'],
    ['^[a-z0-9_]+$', 'name on custom fields'],
  ])('%s (%s) is kept and compiles', (source) => {
    const out = translateDjangoPattern(source);
    expect(out.js).toBe(source);
    expect(() => new RegExp(out.js as string)).not.toThrow();
  });

  test('the kept slug pattern accepts an ordinary slug and refuses a space', () => {
    const rx = new RegExp(translateDjangoPattern('^[-a-zA-Z0-9_]+$').js as string);
    expect(rx.test('mgmt-vlan-10')).toBe(true);
    expect(rx.test('mgmt vlan')).toBe(false);
  });
});

describe('a Python-Unicode shorthand is dropped, never narrowed', () => {
  /**
   * ⛔ BOTH OF THESE ARE REAL NETBOX 4.7.0 PATTERNS, measured 2026-09-22: `^[-\w]+$` on a `slug`
   *   and `^[\w.@+-]+$` on a `username`.
   */
  test.each([
    ['^[-\\w]+$', 'slug'],
    ['^[\\w.@+-]+$', 'username'],
  ])('%s (%s) is NOT carried into a RegExp', (source) => {
    expect(translateDjangoPattern(source).js).toBeUndefined();
  });

  /**
   * ⚠️ THE PROOF THAT DROPPING IS THE RIGHT CALL, not caution. A JavaScript copy of `^[-\w]+$`
   *   compiles happily and then REFUSES a value Django accepts.
   */
  test('the JavaScript copy would have refused a slug Django accepts', () => {
    expect(new RegExp('^[-\\w]+$').test('zürich-core')).toBe(false);
    expect(translateDjangoPattern('^[-\\w]+$').js).toBeUndefined();
  });

  test('Python-only syntax is dropped too, rather than throwing at plan time', () => {
    for (const source of ['(?i)^abc$', '^(?P<name>[a-z]+)$', '\\Aabc\\Z', '^\\d{3}$']) {
      expect(translateDjangoPattern(source).js).toBeUndefined();
    }
  });

  /** ⚠️ No flags are ever lifted: Django emits none, so inventing one would widen the rule. */
  test('nothing is ever returned with flags', () => {
    expect(translateDjangoPattern('^[0-9a-f]{6}$').flags).toBe('');
    expect(translateDjangoPattern('^[-\\w]+$').flags).toBe('');
  });
});

/**
 * The dialect table is what wires the translator and the anchoring rule to a product, and BOTH
 * halves have to be right per vendor.
 *
 * ⛔ THE FAILURE IT GUARDS IS A THIRD PRODUCT ADDED WITH ONE HALF FORGOTTEN. The forgotten half
 *   does not fail loudly — it silently enforces the wrong rule, which is the whole class of bug
 *   this pipeline exists to prevent.
 */
describe('the netbox dialect', () => {
  test('uses the Django translator: a Unicode shorthand is recorded, not enforced', () => {
    expect(patternRule('^[-\\w]+$', 'netbox')).toEqual({ patternSource: '^[-\\w]+$' });
  });

  /**
   * ⛔ NOT ANCHORED, unlike PVE. NetBox's own patterns already carry `^…$` — all 7, measured —
   *   and Django validates with `re.search`, so re-anchoring would invent a rule the vendor does
   *   not have. PVE is the opposite case and is anchored for its own measured reason.
   */
  test('does not re-anchor a pattern the vendor already anchored', () => {
    expect(patternRule('^[0-9a-f]{6}$', 'netbox')).toEqual({
      pattern: '^[0-9a-f]{6}$',
      patternSource: '^[0-9a-f]{6}$',
    });
  });

  test('PVE still anchors, so the table did not flatten the two vendors together', () => {
    expect(patternRule('[a-z]+', 'pve').pattern).toBe('^[a-z]+\\n?$');
    expect(patternRule('[a-z]+', 'netbox').pattern).toBe('[a-z]+');
  });
});
