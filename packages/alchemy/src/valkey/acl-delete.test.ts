/** Delete removes only the users the declaration managed, never what the instance merely holds. */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeValkeyAclFileHandlers } from './acl.ts';
import type { ValkeyAclFileAttributes, ValkeyAclFileProps } from './acl-attrs.ts';
import { managedUserNames } from './acl-managed.ts';
import { reconcileWithExecutor } from './acl-reconcile.ts';
import { type FakeValkey, makeFakeValkey } from './fake-valkey.ts';
import { connection, context, run } from './handler-test-fixture.ts';

const seat = {
  name: 'seat',
  profile: 'seat',
  password: { fromEnv: 'TEST_VALKEY_SEAT_PW' },
} as const;
const draft = {
  name: 'draft',
  profile: 'seat',
  password: { fromEnv: 'TEST_VALKEY_DRAFT_PW' },
} as const;
const foreign = {
  name: 'operator',
  profile: 'seat',
  password: { fromEnv: 'TEST_VALKEY_OPERATOR_PW' },
} as const;
const props: ValkeyAclFileProps = { instance: 'scratch', users: { seat } };
const env = { TEST_VALKEY_SEAT_PW: 'FAKE-seat' };
const admin = 'user admin on >FAKE-admin ~* &* +@all';
const operator = 'user operator on >FAKE-operator ~* &* +@all';
const monitor = 'user monitor on >FAKE-monitor -@all';
const survivors = ['admin', 'monitor', 'operator'];

const instance = (): FakeValkey =>
  makeFakeValkey({ acl: { admin, operator, monitor }, passwords: { admin: 'FAKE-admin' } });
// The state the engine would hold after a real reconcile: every observed user in `users`,
// ownership recorded separately in `managedUsers`.
const stored = (fake: FakeValkey): Promise<ValkeyAclFileAttributes> =>
  Effect.runPromise(reconcileWithExecutor(fake, props, undefined, env, 'admin'));
const remove = (
  fake: FakeValkey,
  olds: ValkeyAclFileProps,
  output: ValkeyAclFileAttributes,
): Promise<void> =>
  run(makeValkeyAclFileHandlers(connection(fake)).delete({ ...context, olds, output }));
const delusers = (fake: FakeValkey) =>
  fake.commands.filter(({ args }) => args[1] === 'DELUSER').map(({ args }) => args);

test('delete removes only the managed user, not an operator, monitor or admin user', async () => {
  const fake = instance();
  const output = await stored(fake);
  expect(Object.keys(output.users).sort()).toEqual(['monitor', 'operator', 'seat']);
  expect(output.managedUsers).toEqual(['seat']);
  await remove(fake, props, output);
  expect(delusers(fake)).toEqual([['ACL', 'DELUSER', 'seat']]);
  expect([...fake.acl.keys()].sort()).toEqual(survivors);
});

test('delete on state written before managedUsers existed falls back as managedUserNames does', async () => {
  const fake = instance();
  const { managedUsers: _dropped, ...legacy } = await stored(fake);
  expect(legacy).not.toHaveProperty('managedUsers');
  expect(managedUserNames(legacy, props)).toEqual(['seat']);
  await remove(fake, props, legacy);
  expect(delusers(fake)).toEqual([['ACL', 'DELUSER', ...managedUserNames(legacy, props)]]);
  expect([...fake.acl.keys()].sort()).toEqual(survivors);
});

test('delete after a failed update spares users the last good reconcile never managed', async () => {
  // The engine commits the NEW declaration as `olds` before reconcile runs. If reconcile then
  // fails, `olds` names `draft` and a foreign live user (`operator`) while `output.managedUsers`
  // still holds the last successful ownership record.
  const fake = instance();
  const output = await stored(fake);
  const failedUpdate: ValkeyAclFileProps = {
    instance: 'scratch',
    users: { seat, draft, operator: foreign },
  };
  await remove(fake, failedUpdate, output);
  expect(delusers(fake)).toEqual([['ACL', 'DELUSER', 'seat']]);
  expect([...fake.acl.keys()].sort()).toEqual(survivors);
});

test('delete never targets the connection user or default, even from a corrupted record', async () => {
  const fake = instance();
  const output = await stored(fake);
  await remove(fake, props, { ...output, managedUsers: ['admin', 'default', 'seat'] });
  expect(delusers(fake)).toEqual([['ACL', 'DELUSER', 'seat']]);
  expect(fake.acl.has('admin')).toBe(true);
});
