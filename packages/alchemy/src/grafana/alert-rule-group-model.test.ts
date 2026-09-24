/**
 * `normalizeRule`/`toWireRule` in isolation — no SDK, no fake, no Effect. Mirrors
 * `dashboard-model.test.ts`. Proves the volatile fields (`id`, `updated`, `provenance`) are
 * stripped and `folderUID`/`ruleGroup`/`orgID` are forced to canonical values regardless of what a
 * live-read rule embeds, which is what makes a pasted export and a freshly-read live rule compare
 * equal in `alert-rule-group.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import { normalizeRule, toWireRule } from './alert-rule-group-model.ts';

describe('normalizeRule', () => {
  test('strips id, updated and provenance', () => {
    const rule = {
      condition: 'A',
      id: 42,
      provenance: 'api',
      title: 'High CPU',
      updated: '2026-09-24T00:00:00Z',
    };
    expect(normalizeRule(rule, 'infra', 'default')).toEqual({
      condition: 'A',
      title: 'High CPU',
      folderUID: 'infra',
      ruleGroup: 'default',
      orgID: 1,
    });
  });

  test('forces folderUID/ruleGroup/orgID to the canonical values, overwriting stale ones', () => {
    const rule = { folderUID: 'stale', orgID: 99, ruleGroup: 'stale-group', title: 'High CPU' };
    expect(normalizeRule(rule, 'infra', 'default')).toEqual({
      title: 'High CPU',
      folderUID: 'infra',
      ruleGroup: 'default',
      orgID: 1,
    });
  });

  test('a declared rule and a live rule that only disagree on volatile fields normalize equal', () => {
    const declared = { condition: 'A', title: 'High CPU' };
    const live = {
      condition: 'A',
      folderUID: 'infra',
      id: 7,
      orgID: 1,
      provenance: 'api',
      ruleGroup: 'default',
      title: 'High CPU',
      updated: '2026-09-24T00:00:00Z',
    };
    expect(normalizeRule(declared, 'infra', 'default')).toEqual(
      normalizeRule(live, 'infra', 'default'),
    );
  });

  test('leaves a real content change genuinely different', () => {
    const declared = { title: 'High CPU v2' };
    const live = { title: 'High CPU' };
    expect(normalizeRule(declared, 'infra', 'default')).not.toEqual(
      normalizeRule(live, 'infra', 'default'),
    );
  });
});

describe('toWireRule', () => {
  test('fills in the group-derived fields, orgID defaulted to 1', () => {
    const rule = { condition: 'A', title: 'High CPU', uid: 'high-cpu' } as never;
    expect(toWireRule(rule, 'infra', 'default')).toMatchObject({
      folderUID: 'infra',
      orgID: 1,
      ruleGroup: 'default',
      uid: 'high-cpu',
    });
  });
});
