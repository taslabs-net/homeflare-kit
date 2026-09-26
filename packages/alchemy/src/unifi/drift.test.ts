/**
 * `makeDriftOf` (B6) against a synthetic field list — no SDK, no HTTP. `network.test.ts` and
 * `firewall-zone.test.ts` each prove their own family's `driftOf` on top of this; this file proves
 * the framework itself: an exact match reports nothing, a drifted field reports its own live and
 * declared values (never swallowing a real difference into a single boolean), several drifted
 * fields all report, and a custom `equal` overrides the default `deepEqual`.
 */
import { describe, expect, test } from 'bun:test';
import { type DriftField, makeDriftOf } from './drift.ts';

interface Widget {
  name: string;
  tags: string[];
  nested: { count: number } | undefined;
}

const FIELDS: readonly DriftField<Widget, Widget>[] = [
  { field: 'name', live: (a) => a.name, declared: (p) => p.name },
  { field: 'nested', live: (a) => a.nested, declared: (p) => p.nested },
  {
    field: 'tags',
    live: (a) => a.tags,
    declared: (p) => p.tags,
    equal: (live, declared) =>
      [...(live as string[])].sort().join(',') === [...(declared as string[])].sort().join(','),
  },
];

const widget = (overrides: Partial<Widget> = {}): Widget => ({
  name: 'lan',
  nested: { count: 1 },
  tags: ['a', 'b'],
  ...overrides,
});

describe('makeDriftOf', () => {
  const driftOf = makeDriftOf(FIELDS);

  test('an exact match reports nothing', () => {
    const attrs = widget();
    expect(driftOf(attrs, widget())).toEqual([]);
  });

  test('a drifted field reports its own live and declared values', () => {
    const attrs = widget({ name: 'lan' });
    const props = widget({ name: 'guest' });
    expect(driftOf(attrs, props)).toEqual([{ field: 'name', live: 'lan', declared: 'guest' }]);
  });

  test('several drifted fields all report, independently', () => {
    const attrs = widget({ name: 'lan', nested: { count: 1 } });
    const props = widget({ name: 'guest', nested: { count: 2 } });
    expect(driftOf(attrs, props)).toEqual([
      { field: 'name', live: 'lan', declared: 'guest' },
      { field: 'nested', live: { count: 1 }, declared: { count: 2 } },
    ]);
  });

  test('the default comparison strips nullish, matching every matches() in this directory', () => {
    const attrs = widget({ nested: undefined });
    const props = { ...widget(), nested: null as unknown as undefined };
    expect(driftOf(attrs, props)).toEqual([]);
  });

  test('a custom `equal` overrides the default -- an unordered set is not drift', () => {
    const attrs = widget({ tags: ['b', 'a'] });
    const props = widget({ tags: ['a', 'b'] });
    expect(driftOf(attrs, props)).toEqual([]);
  });

  test('a custom `equal` still reports a genuine difference', () => {
    const attrs = widget({ tags: ['a', 'b'] });
    const props = widget({ tags: ['a', 'c'] });
    expect(driftOf(attrs, props)).toEqual([
      { field: 'tags', live: ['a', 'b'], declared: ['a', 'c'] },
    ]);
  });
});
