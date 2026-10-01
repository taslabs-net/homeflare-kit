/** Delete removes only the users the declaration managed, never what the instance merely holds. */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeValkeyAclFileHandlers } from './acl.ts';
import type { ValkeyAclFileAttributes, ValkeyAclFileProps } from './acl-attrs.ts';
import { managedUserNames } from './acl-managed.ts';
import { readWithExecutor } from './acl-ops.ts';
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
const draftAcl = 'user draft on >FAKE-draft ~draft:* &draft:* +@all';
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

test('read-without-output seals empty, so legacy state with no managedUsers and no previous answers []', async () => {
  // ★ Apply.ts calls reconcile with `olds: undefined` and `output: attr` on both create (:924)
  //   and replacement (:1321), never a bare read. The empty-seal fallback in `managedUserNames`
  //   (`previous === undefined`) therefore only ever fires on state that predates `managedUsers`
  //   AND was last read without an output — where `[]` is the safe default, not a Valkey adoption
  //   bug. A read with no output mints an empty seal (acl-ops.ts `toUserAttributes`), and with no
  //   `previous` to lean on, that is indistinguishable from "nothing we ever managed".
  const fake = makeFakeValkey({ acl: { seat: 'user seat on >FAKE-seed ~seat:* +@read' } });
  const bare = await Effect.runPromise(readWithExecutor(fake, 'scratch'));
  expect(bare.users.seat?.passwordSeal).toBe('');
  expect(managedUserNames({ instance: 'scratch', users: bare.users }, undefined)).toEqual([]);
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

test('delete removes only output.managedUsers, never users listed in olds', async () => {
  const fake = instance();
  const output = await stored(fake);
  // `olds` claims live users (`operator`) and reserved names (`admin`, `default`) that the
  // declaration no longer manages. Only `output.managedUsers` may be targets.
  const corruptedOlds: ValkeyAclFileProps = {
    instance: 'scratch',
    users: { seat, operator: foreign, admin: foreign, default: foreign },
  } as unknown as ValkeyAclFileProps;
  await remove(fake, corruptedOlds, { ...output, managedUsers: ['seat'] });
  expect(delusers(fake)).toEqual([['ACL', 'DELUSER', 'seat']]);
  expect([...fake.acl.keys()].sort()).toEqual(['admin', 'monitor', 'operator']);
});

test('delete after a partially-applied failed update spares users it never managed', async () => {
  // The engine committed the new declaration as `olds` before reconcile ran. Reconcile then
  // partially applied `draft` before failing; `output` still carries the last successful
  // ownership record (`managedUsers: ['seat']`) but `draft` is already live.
  const partial = makeFakeValkey({
    acl: { admin, operator, monitor, draft: draftAcl },
    passwords: { admin: 'FAKE-admin' },
  });
  const output = await stored(partial);
  expect(Object.keys(output.users).sort()).toEqual(['draft', 'monitor', 'operator', 'seat']);
  expect(output.managedUsers).toEqual(['seat']);
  const failedUpdate: ValkeyAclFileProps = { instance: 'scratch', users: { seat, draft } };
  await remove(partial, failedUpdate, output);
  expect(delusers(partial)).toEqual([['ACL', 'DELUSER', 'seat']]);
  expect([...partial.acl.keys()].sort()).toEqual(['admin', 'draft', 'monitor', 'operator']);
});
