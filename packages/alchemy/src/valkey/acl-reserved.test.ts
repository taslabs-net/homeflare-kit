/**
 * Declaring `default` or the connection username must fail before any `ACL SETUSER`.
 * Read hides those names, so a plan would otherwise create them and `reset` the
 * credential the kit authenticates with.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { reconcileWithExecutor } from './acl-reconcile.ts';
import { ValkeyAclReservedUser } from './errors.ts';
import { makeFakeValkey } from './fake-valkey.ts';
import type { ValkeyAclUser } from './acl-attrs.ts';

const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

const env = { CLAUDE_PW: 'FAKE-seat-password' };
const claude: ValkeyAclUser = {
  name: 'claude',
  keyPrefix: 'claude:*',
  profile: 'seat',
  password: { fromEnv: 'CLAUDE_PW' },
};

const setuser = (fake: ReturnType<typeof makeFakeValkey>): ReadonlyArray<unknown> =>
  fake.commands.filter((command) => command.args[0] === 'ACL' && command.args[1] === 'SETUSER');

describe('reserved ACL names', () => {
  test('refuses to declare the connection username before any SETUSER', async () => {
    const fake = makeFakeValkey({ acl: { admin: 'user admin on >FAKE-seed ~* +@all' } });
    const admin: ValkeyAclUser = {
      name: 'admin',
      keyPrefix: 'admin:*',
      profile: 'seat',
      password: { fromEnv: 'CLAUDE_PW' },
    };
    const error = await fails(
      reconcileWithExecutor(
        fake,
        { instance: 'valkey-seats', users: { admin, claude } },
        undefined,
        env,
        'admin',
      ),
    );
    expect(setuser(fake)).toEqual([]);
    expect(error).toBeInstanceOf(ValkeyAclReservedUser);
    expect(fake.acl.get('admin')).toContain('~* resetchannels +@all');
  });

  test('refuses to declare default before any SETUSER', async () => {
    const fake = makeFakeValkey({ acl: { default: 'user default off' } });
    const reserved: ValkeyAclUser = {
      name: 'default',
      keyPrefix: '*',
      profile: 'service',
      password: { fromEnv: 'CLAUDE_PW' },
    };
    const error = await fails(
      reconcileWithExecutor(
        fake,
        { instance: 'valkey-seats', users: { default: reserved } },
        undefined,
        env,
        'admin',
      ),
    );
    expect(error).toBeInstanceOf(ValkeyAclReservedUser);
    expect(setuser(fake)).toEqual([]);
  });
});
