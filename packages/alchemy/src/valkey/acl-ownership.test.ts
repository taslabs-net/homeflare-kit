/** Round-3 regressions: shared ACL ownership, observability and namespace boundaries. */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { buildSetUserArgs, parseAclLine } from './acl-form.ts';
import { reconcileWithExecutor } from './acl-reconcile.ts';
import type { ValkeyAclUser } from './acl-attrs.ts';
import { makeFakeValkey } from './fake-valkey.ts';
import { required } from './handler-test-fixture.ts';
import { MONITOR_COMMANDS } from './acl-profiles.ts';

const env = { TEST_VALKEY_USER_PW: 'FAKE-test-password' };
const monitor: ValkeyAclUser = {
  name: 'monitor',
  profile: 'monitor',
  password: { fromEnv: 'TEST_VALKEY_USER_PW' },
};
const monitorLine = `user monitor on #${'a'.repeat(64)} resetchannels ${MONITOR_COMMANDS}`;
const run = Effect.runPromise;

test('undeclared monitor survives default reconcile, with its ACL unchanged', async () => {
  const fake = makeFakeValkey({ acl: { monitor: monitorLine } });
  const before = fake.acl.get('monitor');
  const output = await run(
    reconcileWithExecutor(fake, { instance: 'scratch', users: {} }, undefined, {}),
  );
  expect(output.users.monitor?.profile).toBe('monitor');
  expect(fake.acl.get('monitor')).toBe(before);
  expect(fake.commands.some(({ args }) => args[1] === 'DELUSER')).toBe(false);
});

test('exclusive ownership deletes undeclared users, preserving default and admin', async () => {
  const fake = makeFakeValkey({
    acl: {
      monitor: monitorLine,
      default: 'user default off -@all',
      admin: 'user admin on >FAKE-admin ~* &* +@all',
    },
  });
  await run(
    reconcileWithExecutor(
      fake,
      { instance: 'scratch', users: {}, exclusive: true },
      undefined,
      {},
      'admin',
    ),
  );
  expect([...fake.acl.keys()].sort()).toEqual(['admin', 'default']);
});

test('monitor converges with exactly ct100#117 observability rules and no keys/channels', async () => {
  const fake = makeFakeValkey();
  const props = { instance: 'scratch', users: { monitor } };
  const first = await run(reconcileWithExecutor(fake, props, undefined, env));
  expect(first.users.monitor?.profile).toBe('monitor');
  const parsed = parseAclLine(required(fake.acl.get('monitor')));
  expect(parsed.rules).toEqual(MONITOR_COMMANDS.split(' '));
  expect(parsed.keyPatterns).toEqual([]);
  expect(parsed.channelPatterns).toEqual([]);
  const count = fake.commands.filter(({ args }) => args[1] === 'SETUSER').length;
  await run(reconcileWithExecutor(fake, props, first, env));
  expect(fake.commands.filter(({ args }) => args[1] === 'SETUSER')).toHaveLength(count);
});

test('service channel scope defaults to keyPrefix; foreign PUBLISH is NOPERM', async () => {
  const fake = makeFakeValkey();
  const service: ValkeyAclUser = {
    ...monitor,
    name: 'cache',
    profile: 'service',
    keyPrefix: 'cache:*',
  };
  await run(
    reconcileWithExecutor(fake, { instance: 'scratch', users: { cache: service } }, undefined, env),
  );
  expect(await run(fake.send(['AUTH', 'cache', env.TEST_VALKEY_USER_PW]))).toEqual({
    kind: 'bulk',
    value: 'OK',
  });
  expect(await run(fake.send(['PUBLISH', 'cache:events', 'x']))).toEqual({
    kind: 'bulk',
    value: '0',
  });
  expect(await run(fake.send(['PUBLISH', 'foreign:events', 'x']))).toMatchObject({
    kind: 'error',
    message: 'NOPERM No permissions to access a channel',
  });
});

test('service may declare separate channel patterns, including no channels', async () => {
  const service: ValkeyAclUser = {
    ...monitor,
    name: 'cache',
    profile: 'service',
    keyPrefix: 'cache:*',
    channelPatterns: ['events:*'],
  };
  const args = await run(buildSetUserArgs(service, env.TEST_VALKEY_USER_PW));
  expect(args).toContain('&events:*');
  expect(args).not.toContain('&cache:*');
  expect(
    (
      await run(buildSetUserArgs({ ...service, channelPatterns: [] }, env.TEST_VALKEY_USER_PW))
    ).some((arg) => arg.startsWith('&')),
  ).toBe(false);
});

test('fake echoes hashes and baseline, adds passwords, and reset revokes the old password', async () => {
  const fake = makeFakeValkey();
  await run(fake.send(['ACL', 'SETUSER', 'seat', 'on', '>FAKE-first', '+ping']));
  await run(fake.send(['ACL', 'SETUSER', 'seat', '>FAKE-second']));
  expect(fake.acl.get('seat')).toContain('-@all +ping');
  expect(fake.acl.get('seat')).not.toContain('FAKE-');
  expect(await run(fake.send(['AUTH', 'seat', 'FAKE-first']))).toMatchObject({ value: 'OK' });
  await run(fake.send(['ACL', 'SETUSER', 'seat', 'reset', 'on', '>FAKE-second', '+ping']));
  expect(await run(fake.send(['AUTH', 'seat', 'FAKE-first']))).toMatchObject({ kind: 'error' });
  expect(await run(fake.send(['AUTH', 'seat', 'FAKE-second']))).toMatchObject({ value: 'OK' });
});
