/**
 * `group-form.ts`'s pure functions against literal `ModelIfgroupentryReadItem` fixtures (the
 * WHOLE-MODEL `get()`'s read-shaped item — `members` is an option map, OPNSENSE-2) — no network.
 */
import { describe, expect, test } from 'bun:test';
import type * as group from '@distilled.cloud/opnsense/firewall_group';
import { attributesOf, matches } from './group-form.ts';
import type { GroupProps } from './group.ts';
import { optionMap } from './wire.ts';

const UUID = '33333333-3333-3333-3333-333333333333';

const liveGroup = (
  overrides: Partial<group.ModelIfgroupentryReadItem> = {},
): group.ModelIfgroupentryReadItem => ({
  ifname: 'IOT_DEVICES',
  members: optionMap('opt1', 'opt2'),
  sequence: '1',
  ...overrides,
});

describe('group-form attributesOf', () => {
  test('settles OPNsense wire spellings to plain values', () => {
    expect(attributesOf(UUID, liveGroup())).toEqual({
      description: '',
      ifname: 'IOT_DEVICES',
      members: ['opt1', 'opt2'],
      nogroup: false,
      sequence: 1,
      uuid: UUID,
    });
  });

  test('members are the selected keys, sorted and deduplicated', () => {
    const live = liveGroup({ members: optionMap('opt2', 'opt1') });
    expect(attributesOf(UUID, live).members).toEqual(['opt1', 'opt2']);
  });

  test('a non-numeric sequence falls back rather than becoming NaN', () => {
    expect(attributesOf(UUID, liveGroup({ sequence: 'not-a-number' })).sequence).toBe(0);
  });
});

describe('group-form matches', () => {
  const props: GroupProps = {
    ifname: 'IOT_DEVICES',
    members: ['opt1', 'opt2'],
    sequence: 1,
    uuid: UUID,
  };

  test('a live item decoded through attributesOf matches its own declaration', () => {
    expect(matches(attributesOf(UUID, liveGroup()), props)).toBe(true);
  });

  test('member-list order alone is not drift', () => {
    const live = attributesOf(UUID, liveGroup({ members: optionMap('opt2', 'opt1') }));
    const declared: GroupProps = { ...props, members: ['opt1', 'opt2'] };
    expect(matches(live, declared)).toBe(true);
  });

  test('a removed member is drift', () => {
    const live = attributesOf(UUID, liveGroup({ members: optionMap('opt1') }));
    expect(matches(live, props)).toBe(false);
  });
});

describe('propsFromLive round-trip', () => {
  test('the props it returns plan noop against the exact live object they came from', () => {
    const live = liveGroup({
      descr: 'IoT VLANs',
      members: optionMap('opt3', 'opt1', 'opt2'),
      nogroup: '1',
      sequence: '5',
    });
    const rendered = attributesOf(UUID, live);
    expect(matches(attributesOf(UUID, live), rendered)).toBe(true);
  });
});
