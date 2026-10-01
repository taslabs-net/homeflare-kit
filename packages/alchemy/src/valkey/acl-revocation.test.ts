/** A removed seat must lose access without claiming ownership of an operator's users. */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeValkeyAclFileHandlers } from './acl.ts';
import type { ValkeyAclFileProps } from './acl-attrs.ts';
import { reconcileWithExecutor } from './acl-reconcile.ts';
import { makeFakeValkey } from './fake-valkey.ts';
import { config, connection, context, required, run } from './handler-test-fixture.ts';
import { ValkeySocketError } from './transport.ts';
import type { withValkey } from './connection.ts';

const props: ValkeyAclFileProps = {
  instance: 'scratch',
  users: {
    seat: { name: 'seat', profile: 'seat', password: { fromEnv: 'TEST_VALKEY_SEAT_PW' } },
  },
};
const news: ValkeyAclFileProps = { instance: 'scratch', users: {} };
const env = { TEST_VALKEY_SEAT_PW: 'FAKE-seat' };
const operator = 'user operator on >FAKE-operator ~* &* +@all';

for (const legacy of [false, true]) {
  test(`removing a managed seat plans an update and revokes AUTH, preserving never-managed users (legacy=${legacy})`, async () => {
    const fake = makeFakeValkey({ acl: { operator }, passwords: { admin: 'FAKE-admin' } });
    const created = await Effect.runPromise(reconcileWithExecutor(fake, props, undefined, env));
    const operatorBefore = fake.acl.get('operator');
    const stored = legacy ? { instance: created.instance, users: created.users } : created;
    expect(
      await Effect.runPromise(fake.send(['AUTH', 'seat', env.TEST_VALKEY_SEAT_PW])),
    ).toMatchObject({ value: 'OK' });
    const handlers = makeValkeyAclFileHandlers(connection(fake));
    expect(
      await run(required(handlers.diff)({ ...context, olds: props, news, output: stored })),
    ).toEqual({ action: 'update' });
    // A drift read must preserve ownership independently of all the live users it observes.
    const observed = required(
      await run(required(handlers.read)({ ...context, olds: props, output: stored })),
    );
    expect(observed.managedUsers).toEqual(['seat']);
    const output = await run(
      handlers.reconcile({ ...context, olds: props, news, output: observed }),
    );
    expect(output.managedUsers).toEqual([]);
    expect(Object.keys(output.users)).toEqual(['operator']);
    expect(fake.acl.get('operator')).toBe(operatorBefore);
    expect(
      fake.commands.filter(({ args }) => args[1] === 'DELUSER').map(({ args }) => args),
    ).toEqual([['ACL', 'DELUSER', 'seat']]);
    expect(
      await Effect.runPromise(fake.send(['AUTH', 'seat', env.TEST_VALKEY_SEAT_PW])),
    ).toMatchObject({ kind: 'error' });
    expect(await run(required(handlers.diff)({ ...context, olds: news, news, output }))).toEqual({
      action: 'noop',
    });
    await run(handlers.reconcile({ ...context, olds: news, news, output }));
    expect(fake.commands.filter(({ args }) => args[1] === 'DELUSER')).toHaveLength(1);
  });
}

test('a removed seat re-added by another writer fails readback even without exclusive ownership', async () => {
  const fake = makeFakeValkey({
    reAddAfterWrite: { name: 'seat', line: 'user seat on nopass -@all' },
  });
  fake.acl.set('seat', 'user seat on nopass -@all');
  const error = await Effect.runPromise(
    Effect.flip(
      reconcileWithExecutor(
        fake,
        news,
        { instance: 'scratch', users: {}, managedUsers: ['seat'] },
        {},
      ),
    ),
  );
  expect(error).toMatchObject({ _tag: 'ValkeyAclReadbackFailed', user: 'seat' });
});

test('ACL socket acquisition failure is mapped before the executor callback can run', async () => {
  const connect: typeof withValkey = () =>
    Effect.fail(new ValkeySocketError({ reason: 'ECONNREFUSED' }));
  const handlers = makeValkeyAclFileHandlers(connect);
  for (const operation of [
    required(handlers.read)({ ...context, olds: props, output: undefined }),
    handlers.reconcile({ ...context, olds: props, news: props, output: undefined }),
    handlers.delete({ ...context, olds: props, output: { instance: 'scratch', users: {} } }),
  ]) {
    expect(await run(Effect.flip(operation))).toMatchObject({
      _tag: 'ValkeyInstanceUnreachable',
      instance: 'scratch',
      host: config.host,
      port: config.port,
    });
  }
});
