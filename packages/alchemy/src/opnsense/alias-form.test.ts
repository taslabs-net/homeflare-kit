/**
 * `alias-form.ts`'s pure functions against literal `ModelAliasReadItem` fixtures (the WHOLE-MODEL
 * `get()`'s read-shaped item, option maps and all — OPNSENSE-2) — no network, no fake server.
 * Mirrors `../discord/command-form.ts`'s own test file in spirit.
 */
import { describe, expect, test } from 'bun:test';
import type * as alias from '@distilled.cloud/opnsense/firewall_alias';
import { attributesOf, matches } from './alias-form.ts';
import type { AliasProps } from './alias.ts';
import { optionMap } from './wire.ts';

const UUID = '11111111-1111-1111-1111-111111111111';

const liveHost = (overrides: Partial<alias.ModelAliasReadItem> = {}): alias.ModelAliasReadItem => ({
  content: optionMap('10.20.10.1'),
  enabled: '1',
  name: 'homeflare_edge',
  type: optionMap('host'),
  ...overrides,
});

describe('alias-form attributesOf', () => {
  test('settles OPNsense wire spellings to plain values', () => {
    expect(attributesOf(UUID, liveHost())).toEqual({
      categories: [],
      content: '10.20.10.1',
      counters: false,
      description: '',
      enabled: true,
      interface: '',
      name: 'homeflare_edge',
      proto: '',
      type: 'host',
      updatefreq: 0,
      uuid: UUID,
    });
  });

  test('"0" is disabled, not absent', () => {
    expect(attributesOf(UUID, liveHost({ enabled: '0' })).enabled).toBe(false);
  });

  test('categories are the selected keys, sorted and deduplicated', () => {
    const live = liveHost({ categories: optionMap('c-two', 'c-one') });
    expect(attributesOf(UUID, live).categories).toEqual(['c-one', 'c-two']);
  });

  test('an unselected option-map entry is not returned (single-select `type`)', () => {
    const live = liveHost({
      type: {
        host: { value: 'Host(s)', selected: 1 },
        network: { value: 'Network(s)', selected: 0 },
      },
    });
    expect(attributesOf(UUID, live).type).toBe('host');
  });
});

describe('alias-form matches', () => {
  const props: AliasProps = {
    content: '10.20.10.1',
    name: 'homeflare_edge',
    type: 'host',
    uuid: UUID,
  };

  test('a live item decoded through attributesOf matches its own declaration', () => {
    expect(matches(attributesOf(UUID, liveHost()), props)).toBe(true);
  });

  test('content drift is caught', () => {
    const drifted = attributesOf(UUID, liveHost({ content: optionMap('10.20.10.2') }));
    expect(matches(drifted, props)).toBe(false);
  });

  test('category order alone is not drift — both sides normalise through the same set', () => {
    const live = attributesOf(UUID, liveHost({ categories: optionMap('b', 'a') }));
    const declared: AliasProps = { ...props, categories: ['a', 'b'] };
    expect(matches(live, declared)).toBe(true);
  });

  test('an undeclared optional field takes its settled default, not a mismatch', () => {
    // `proto`/`interface`/`description` etc. are absent from `props` here; `liveHost()` also
    // never sets them, so both sides settle to the same empty defaults.
    expect(matches(attributesOf(UUID, liveHost()), props)).toBe(true);
  });
});

describe('propsFromLive round-trip — the declaration renderer whole contract', () => {
  test('the props it returns plan noop against the exact live object they came from', () => {
    // alias.ts re-exports `attributesOf` itself as `propsFromLive`; tested directly here since
    // alias.ts also wires up the Resource machinery this file does not need to import.
    const live = liveHost({
      categories: optionMap('c-two', 'c-one'),
      content: optionMap('203.0.113.0/24'),
      type: optionMap('network'),
    });
    const rendered = attributesOf(UUID, live);
    expect(matches(attributesOf(UUID, live), rendered)).toBe(true);
  });
});
