/**
 * A seat profile must not grant another seat's keys. `keyPrefix` is interpolated as
 * `~${keyPrefix}` and read-back compares the declaration to itself, so `*` or `grok:*`
 * on user `claude` would converge and widen the keyspace. Refused before any `ACL SETUSER`.
 * `*` stays legal on the service profile — that user owns the instance.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import type { ValkeyAclUser } from './acl-attrs.ts';
import { reconcileWithExecutor } from './acl-ops.ts';
import { ValkeyAclSeatKeyPrefix } from './errors.ts';
import { makeFakeValkey } from './fake-valkey.ts';

const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

const env = { CLAUDE_PW: 'hunter2', LITELLM_PW: 'cachepw' };

const setuser = (fake: ReturnType<typeof makeFakeValkey>): ReadonlyArray<unknown> =>
  fake.commands.filter((command) => command.args[0] === 'ACL' && command.args[1] === 'SETUSER');

describe('seat key prefix', () => {
  test("a seat keyPrefix of '*' issues no SETUSER", async () => {
    const fake = makeFakeValkey({ acl: { admin: 'user admin on >h ~* +@all' } });
    const claude: ValkeyAclUser = {
      name: 'claude',
      keyPrefix: '*',
      profile: 'seat',
      password: { fromEnv: 'CLAUDE_PW' },
    };
    const error = await fails(
      reconcileWithExecutor(
        fake,
        { instance: 'valkey-seats', users: { claude } },
        undefined,
        env,
        'admin',
      ),
    );
    expect(setuser(fake)).toEqual([]);
    expect(error).toBeInstanceOf(ValkeyAclSeatKeyPrefix);
    expect(fake.acl.has('claude')).toBe(false);
  });

  test('a seat keyPrefix that only shares the name prefix issues no SETUSER', async () => {
    const fake = makeFakeValkey();
    const claude: ValkeyAclUser = {
      name: 'claude',
      keyPrefix: 'claude:grok:*',
      profile: 'seat',
      password: { fromEnv: 'CLAUDE_PW' },
    };
    const error = await fails(
      reconcileWithExecutor(
        fake,
        { instance: 'valkey-seats', users: { claude } },
        undefined,
        env,
        'admin',
      ),
    );
    expect(setuser(fake)).toEqual([]);
    expect(error).toBeInstanceOf(ValkeyAclSeatKeyPrefix);
  });

  test("a seat keyPrefix of another user's pattern issues no SETUSER", async () => {
    const fake = makeFakeValkey();
    const claude: ValkeyAclUser = {
      name: 'claude',
      keyPrefix: 'grok:*',
      profile: 'seat',
      password: { fromEnv: 'CLAUDE_PW' },
    };
    const error = await fails(
      reconcileWithExecutor(
        fake,
        { instance: 'valkey-seats', users: { claude } },
        undefined,
        env,
        'admin',
      ),
    );
    expect(setuser(fake)).toEqual([]);
    expect(error).toBeInstanceOf(ValkeyAclSeatKeyPrefix);
  });

  test("a service keyPrefix of '*' is still written", async () => {
    const fake = makeFakeValkey();
    const litellm: ValkeyAclUser = {
      name: 'litellm',
      keyPrefix: '*',
      profile: 'service',
      password: { fromEnv: 'LITELLM_PW' },
    };
    const error = await Effect.runPromise(
      reconcileWithExecutor(
        fake,
        { instance: 'valkey-litellm', users: { litellm } },
        undefined,
        env,
        'admin',
      ),
    ).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    // The fake stores `allchannels` rather than the live `&*` echo, so read-back can fail.
    // The refusal under test is the one that must not have fired: SETUSER ran, with `~*`.
    expect(error).not.toBeInstanceOf(ValkeyAclSeatKeyPrefix);
    const wrote = fake.commands.filter(
      (command) => command.args[0] === 'ACL' && command.args[1] === 'SETUSER',
    );
    expect(wrote.length).toBe(1);
    expect(wrote[0]?.args.includes('~*')).toBe(true);
  });
});
