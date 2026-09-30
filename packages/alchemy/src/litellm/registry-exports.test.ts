/**
 * The public barrel re-exports the six registry resources, their providers and guards, and the shared
 * typed refusals. A missing name here is a runtime import failure for a consumer, and nothing else in
 * the tests goes through `index.ts`.
 */
import { expect, test } from 'bun:test';
import * as barrel from './index.ts';

const RESOURCES = [
  ['LiteLLMTeam', 'isLiteLLMTeam', 'LiteLLM.Team', 'LiteLLMTeamProvider'],
  [
    'LiteLLMAccessGroup',
    'isLiteLLMAccessGroup',
    'LiteLLM.AccessGroup',
    'LiteLLMAccessGroupProvider',
  ],
  ['LiteLLMToolset', 'isLiteLLMToolset', 'LiteLLM.Toolset', 'LiteLLMToolsetProvider'],
  ['LiteLLMPolicy', 'isLiteLLMPolicy', 'LiteLLM.Policy', 'LiteLLMPolicyProvider'],
  [
    'LiteLLMPolicyAttachment',
    'isLiteLLMPolicyAttachment',
    'LiteLLM.PolicyAttachment',
    'LiteLLMPolicyAttachmentProvider',
  ],
  ['LiteLLMToolPolicy', 'isLiteLLMToolPolicy', 'LiteLLM.ToolPolicy', 'LiteLLMToolPolicyProvider'],
] as const;

test('every registry resource, guard and provider is on the barrel, and the guard tells its own type', () => {
  const exported = barrel as unknown as Record<string, unknown>;
  for (const [resource, guard, type, provider] of RESOURCES) {
    expect(exported[resource]).toBeDefined();
    expect(typeof exported[provider]).toBe('function');
    const isType = exported[guard] as (value: unknown) => boolean;
    expect(isType({ Type: type })).toBe(true);
    expect(isType({ Type: 'LiteLLM.Budget' })).toBe(false);
    expect(isType(undefined)).toBe(false);
  }
});

test('the shared typed refusals are on the barrel and name their resource and subject', () => {
  const invalid = new barrel.LitellmRegistryInvalidError({
    name: 'FAKE-name',
    problem: 'a problem',
    resource: 'LiteLLM.Team',
  });
  expect(invalid._tag).toBe('LitellmRegistryInvalidError');
  expect(invalid.message).toBe('LiteLLM.Team "FAKE-name": a problem.');
  expect(
    new barrel.LitellmRegistryNotConvergedError({
      fields: ['models'],
      name: 'FAKE-name',
      resource: 'LiteLLM.Team',
    }).message,
  ).toContain('models');
  for (const each of [
    barrel.LitellmRegistryAbsentAfterWriteError,
    barrel.LitellmRegistryAmbiguousError,
    barrel.LitellmRegistryUnreadableError,
  ]) {
    expect(typeof each).toBe('function');
  }
});

test('litellmProviders() builds a layer with every provider merged in', () => {
  expect(barrel.litellmProviders()).toBeDefined();
});
