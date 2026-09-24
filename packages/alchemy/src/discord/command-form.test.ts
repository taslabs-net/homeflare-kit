/**
 * `command-form.ts`'s pure functions — no server, no Effect runtime, the same shape
 * `../netbox/prefix-form.test.ts` uses for `prefixBody`/`prefixMatches`.
 */
import { describe, expect, test } from 'bun:test';
import {
  type CommandFields,
  type CommandFieldsAttributes,
  commandBody,
  commandFieldsOf,
  commandMatches,
} from './command-form.ts';

describe('commandBody', () => {
  test('settles description/nsfw/type when undeclared, the way Discord itself would', () => {
    expect(commandBody({ name: 'ping' })).toEqual({
      description: '',
      name: 'ping',
      nsfw: false,
      type: 1,
    });
  });

  test('an omitted field is left OUT of the body, never sent empty/null/false', () => {
    const body = commandBody({ name: 'ping' });
    expect(Object.prototype.hasOwnProperty.call(body, 'options')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, 'default_member_permissions')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, 'dm_permission')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, 'contexts')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, 'integration_types')).toBe(false);
  });

  test('every declared field reaches the wire body under its wire name', () => {
    const props: CommandFields = {
      contexts: [0, 1],
      defaultMemberPermissions: '2147483648',
      description: 'ping the bot',
      dmPermission: false,
      integrationTypes: [0],
      name: 'ping',
      nsfw: true,
      options: [{ name: 'loud', type: 5 }],
      type: 1,
    };
    expect(commandBody(props)).toEqual({
      contexts: [0, 1],
      default_member_permissions: '2147483648',
      description: 'ping the bot',
      dm_permission: false,
      integration_types: [0],
      name: 'ping',
      nsfw: true,
      options: [{ name: 'loud', type: 5 }],
      type: 1,
    });
  });
});

const attrsOf = (overrides: Partial<CommandFieldsAttributes> = {}): CommandFieldsAttributes => ({
  contexts: undefined,
  defaultMemberPermissions: undefined,
  description: '',
  dmPermission: undefined,
  integrationTypes: undefined,
  name: 'ping',
  nsfw: false,
  options: [],
  type: 1,
  ...overrides,
});

describe('commandMatches', () => {
  test('an exact match reports no drift', () => {
    expect(commandMatches(attrsOf(), { name: 'ping' })).toBe(true);
  });

  test('a description change is drift', () => {
    expect(
      commandMatches(attrsOf({ description: 'old' }), { description: 'new', name: 'ping' }),
    ).toBe(false);
  });

  test('a name change is drift — name is part of identity but still compared', () => {
    expect(commandMatches(attrsOf({ name: 'ping' }), { name: 'pong' })).toBe(false);
  });

  test('options are compared by deep equality, order included', () => {
    const live = attrsOf({ options: [{ name: 'a' }, { name: 'b' }] });
    expect(commandMatches(live, { name: 'ping', options: [{ name: 'a' }, { name: 'b' }] })).toBe(
      true,
    );
    expect(commandMatches(live, { name: 'ping', options: [{ name: 'b' }, { name: 'a' }] })).toBe(
      false,
    );
  });

  test('an undeclared optional field is not compared — "not mine", both directions', () => {
    const live = attrsOf({ defaultMemberPermissions: '8', dmPermission: true });
    expect(commandMatches(live, { name: 'ping' })).toBe(true);
  });

  test('a declared optional field that disagrees with live is drift', () => {
    const live = attrsOf({ defaultMemberPermissions: '8' });
    expect(commandMatches(live, { defaultMemberPermissions: '16', name: 'ping' })).toBe(false);
  });
});

describe('commandFieldsOf', () => {
  test('reads every field off an ApplicationCommandResponse-shaped object, null coerced to undefined', () => {
    expect(
      commandFieldsOf({
        contexts: null,
        default_member_permissions: null,
        description: 'ping the bot',
        dm_permission: undefined,
        integration_types: undefined,
        name: 'ping',
        nsfw: undefined,
        options: null,
        type: 1,
      }),
    ).toEqual(attrsOf({ description: 'ping the bot' }));
  });

  test('nsfw is strictly `=== true`, never truthy-coerced', () => {
    expect(commandFieldsOf({ description: '', name: 'x', nsfw: undefined, type: 1 }).nsfw).toBe(
      false,
    );
  });
});
