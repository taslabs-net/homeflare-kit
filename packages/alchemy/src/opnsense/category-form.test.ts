/**
 * `category-form.ts`'s pure functions against literal `CategoryItem` fixtures — no network.
 */
import { describe, expect, test } from 'bun:test';
import type * as category from '@distilled.cloud/opnsense/firewall_category';
import { attributesOf, matches } from './category-form.ts';
import type { CategoryProps } from './category.ts';

const UUID = '22222222-2222-2222-2222-222222222222';

const liveCategory = (overrides: Partial<category.CategoryItem> = {}): category.CategoryItem => ({
  name: 'vpn-clients',
  ...overrides,
});

describe('category-form attributesOf', () => {
  test('settles OPNsense wire spellings to plain values', () => {
    expect(attributesOf(UUID, liveCategory())).toEqual({
      auto: false,
      color: '',
      name: 'vpn-clients',
      uuid: UUID,
    });
  });

  test('auto="1" is the OPNsense-created flag, not absent', () => {
    expect(attributesOf(UUID, liveCategory({ auto: '1' })).auto).toBe(true);
  });

  test('a declared color is passed through', () => {
    expect(attributesOf(UUID, liveCategory({ color: '0000FF' })).color).toBe('0000FF');
  });
});

describe('category-form matches', () => {
  const props: CategoryProps = { name: 'vpn-clients', uuid: UUID };

  test('a live item decoded through attributesOf matches its own declaration', () => {
    expect(matches(attributesOf(UUID, liveCategory()), props)).toBe(true);
  });

  test('a renamed category is drift', () => {
    const drifted = attributesOf(UUID, liveCategory({ name: 'renamed' }));
    expect(matches(drifted, props)).toBe(false);
  });
});

describe('propsFromLive round-trip', () => {
  test('the props it returns plan noop against the exact live object they came from', () => {
    const live = liveCategory({ auto: '1', color: 'FF0000' });
    const rendered = attributesOf(UUID, live);
    expect(matches(attributesOf(UUID, live), rendered)).toBe(true);
  });
});
