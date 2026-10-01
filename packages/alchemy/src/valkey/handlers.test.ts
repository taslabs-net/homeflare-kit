/** Exercise actual handlers: a failed read must never become a CREATE or skip adoption. */
import { expect, test } from 'bun:test';
import { Unowned } from 'alchemy/AdoptPolicy';
import * as Effect from 'effect/Effect';
import { makeValkeyAclFileHandlers } from './acl.ts';
import { makeValkeyInstanceHandlers } from './instance.ts';
import { makeFakeValkey } from './fake-valkey.ts';
import { connection, context, required, run } from './handler-test-fixture.ts';
import { ValkeyServerError, ValkeySocketError } from './transport.ts';
import { ValkeyAclParseError } from './errors.ts';
import type { ValkeyAclFileProps } from './acl-attrs.ts';
import { reconcileWithExecutor } from './acl-reconcile.ts';

const props: ValkeyAclFileProps = { instance: 'scratch', users: {} };
const attrs = { instance: 'scratch', users: {} };
const instance = { name: 'scratch', port: 0 };
const fake = () => makeFakeValkey({ passwords: { admin: 'FAKE-admin' } });

for (const tag of [
  'ValkeyServerError',
  'ValkeySocketError',
  'ValkeyAuthPasswordMissing',
] as const) {
  test(`read and ACL delete propagate ${tag}, never absence/success`, async () => {
    const ex =
      tag === 'ValkeyAuthPasswordMissing'
        ? fake()
        : {
            send: () =>
              Effect.fail(
                tag === 'ValkeyServerError'
                  ? new ValkeyServerError({ detail: 'WRONGPASS' })
                  : new ValkeySocketError({ reason: 'connection refused' }),
              ),
          };
    const connect = connection(ex, {});
    // Server/socket errors occur after resolving a present credential.
    const session = tag === 'ValkeyAuthPasswordMissing' ? connect : connection(ex);
    const acl = makeValkeyAclFileHandlers(session);
    const inst = makeValkeyInstanceHandlers(session);
    expect(
      (await run(Effect.flip(required(acl.read)({ ...context, olds: props, output: undefined }))))
        ._tag,
    ).toBe(tag);
    expect(
      (
        await run(
          Effect.flip(required(inst.read)({ ...context, olds: instance, output: undefined })),
        )
      )._tag,
    ).toBe(tag);
    expect(
      (await run(Effect.flip(acl.delete({ ...context, olds: props, output: attrs }))))._tag,
    ).toBe(tag);
  });
}

test('wrong AUTH reply fails both reads; successful reads retain the adoption gate', async () => {
  const ex = fake();
  for (const credentials of [
    { TEST_VALKEY_ADMIN_PW: 'FAKE-wrong' },
    { TEST_VALKEY_ADMIN_PW: 'FAKE-admin' },
  ]) {
    const acl = makeValkeyAclFileHandlers(connection(ex, credentials));
    const inst = makeValkeyInstanceHandlers(connection(ex, credentials));
    if (credentials.TEST_VALKEY_ADMIN_PW === 'FAKE-wrong') {
      expect(
        (await run(Effect.flip(required(acl.read)({ ...context, olds: props, output: undefined }))))
          ._tag,
      ).toBe('ValkeyServerError');
      expect(
        (
          await run(
            Effect.flip(required(inst.read)({ ...context, olds: instance, output: undefined })),
          )
        )._tag,
      ).toBe('ValkeyServerError');
    } else {
      expect(
        Unowned.is(await run(required(acl.read)({ ...context, olds: props, output: undefined }))),
      ).toBe(true);
      expect(
        Unowned.is(
          await run(required(inst.read)({ ...context, olds: instance, output: undefined })),
        ),
      ).toBe(true);
    }
  }
});

test('configured ACL file refuses reconcile and delete before SETUSER/DELUSER', async () => {
  const ex = fake();
  ex.config.set('aclfile', '/scratch/readonly.acl');
  const acl = makeValkeyAclFileHandlers(connection(ex));
  for (const effect of [
    acl.reconcile({ ...context, news: props, olds: props, output: attrs }),
    acl.delete({ ...context, olds: props, output: attrs }),
  ]) {
    expect((await run(Effect.flip(effect)))._tag).toBe('ValkeyAclFileRendered');
  }
  expect(
    ex.commands.some(({ args }) => ['SETUSER', 'DELUSER', 'SAVE'].includes(args[1] ?? '')),
  ).toBe(false);
  expect(await run(required(acl.read)({ ...context, olds: props, output: attrs }))).toEqual(attrs);
});

test('delete is repeatable, removes only declared users and preserves admin/undeclared', async () => {
  const ex = fake();
  ex.acl.set('seat', 'user seat on >FAKE-seat -@all');
  ex.acl.set('monitor', 'user monitor on >FAKE-monitor -@all');
  const acl = makeValkeyAclFileHandlers(connection(ex));
  const olds: ValkeyAclFileProps = {
    ...props,
    users: {
      seat: { name: 'seat', profile: 'seat', password: { fromEnv: 'TEST_VALKEY_SEAT_PW' } },
    },
  };
  await run(acl.delete({ ...context, olds, output: attrs }));
  await run(acl.delete({ ...context, olds, output: attrs }));
  expect([...ex.acl.keys()]).toEqual(['monitor']);
  expect(ex.commands.filter(({ args }) => args[1] === 'DELUSER')).toHaveLength(1);
  const inst = makeValkeyInstanceHandlers(connection(ex));
  expect(
    (
      await run(
        Effect.flip(
          inst.delete({
            ...context,
            olds: instance,
            output: {
              ...instance,
              version: '9.1.1',
              maxmemory: '0',
              maxmemoryPolicy: 'noeviction',
              appendonly: 'no',
            },
          }),
        ),
      )
    )._tag,
  ).toBe('ValkeyInstanceDeleteRefused');
});

test('diff compares stored attributes; drift read makes out-of-band channel changes visible', async () => {
  const ex = fake();
  const news: ValkeyAclFileProps = {
    ...props,
    users: {
      seat: { name: 'seat', profile: 'seat', password: { fromEnv: 'TEST_VALKEY_SEAT_PW' } },
    },
  };
  const stored = await Effect.runPromise(
    reconcileWithExecutor(ex, news, undefined, { TEST_VALKEY_SEAT_PW: 'FAKE-seat' }),
  );
  const acl = makeValkeyAclFileHandlers(connection(ex));
  const diff = (output: typeof stored, exclusive = false) =>
    run(required(acl.diff)({ ...context, olds: news, news: { ...news, exclusive }, output }));
  expect(await diff(stored)).toEqual({ action: 'noop' });
  ex.acl.set('seat', required(ex.acl.get('seat')).replace('&seat:*', '&*'));
  expect(await diff(stored)).toEqual({ action: 'noop' });
  const live = await run(required(acl.read)({ ...context, olds: news, output: stored }));
  expect(live?.users.seat?.passwordSeal).toBe(stored.users.seat?.passwordSeal);
  expect(await diff(required(live))).toEqual({ action: 'update' });
  const extra = { ...stored, users: { ...stored.users, monitor: required(stored.users.seat) } };
  expect(await diff(extra)).toEqual({ action: 'noop' });
  expect(await diff(extra, true)).toEqual({ action: 'update' });
  const inst = makeValkeyInstanceHandlers(connection(ex));
  const output = {
    ...instance,
    version: '9.1.1',
    maxmemory: '0',
    maxmemoryPolicy: 'noeviction',
    appendonly: 'no',
  };
  expect(
    await run(required(inst.diff)({ ...context, olds: instance, news: instance, output })),
  ).toEqual({
    action: 'noop',
  });
  expect(
    await run(
      required(inst.diff)({ ...context, olds: instance, news: { ...instance, port: 1 }, output }),
    ),
  ).toEqual({ action: 'update' });
});

test('malformed ACL fails read without retaining the hash in message or data', async () => {
  const ex = fake();
  const executor = {
    send: (args: ReadonlyArray<string>) =>
      args[1] === 'LIST'
        ? Effect.succeed({ kind: 'array' as const, values: ['invalid #FAKE-hash'] })
        : ex.send(args),
  };
  const acl = makeValkeyAclFileHandlers(connection(executor));
  const error = await run(
    Effect.flip(required(acl.read)({ ...context, olds: props, output: undefined })),
  );
  expect(error).toBeInstanceOf(ValkeyAclParseError);
  expect(String(error)).not.toContain('FAKE-hash');
  expect(JSON.stringify(error)).not.toContain('FAKE-hash');
});
