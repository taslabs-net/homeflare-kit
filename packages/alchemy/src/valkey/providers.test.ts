/** Resolve providers from the public layer, exactly as the engine does. */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { ValkeyAclFile } from './acl.ts';
import { ValkeyInstance } from './instance.ts';
import { valkeyProviders } from './providers.ts';
import { resolveValkeyConnection } from './connection-service.ts';
import { context, required } from './handler-test-fixture.ts';
import { providerServer } from './provider-socket-fixture.ts';

const config = (instance: string, port: number) => ({ instance, host: '127.0.0.1', port });

test('valkeyProviders retains the named connection for an AclFile provider read', async () => {
  const server = await providerServer('seat');
  try {
    const output = await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* ValkeyAclFile.Provider;
        return yield* required(provider.read)({
          ...context,
          olds: { instance: 'seats', users: {} },
          output: undefined,
        });
      }).pipe(Effect.provide(valkeyProviders(config('seats', server.port)))),
    );
    expect(Object.keys(required(output).users)).toEqual(['seat']);
    expect(server.fake.commands.map(({ args }) => args)).toEqual([['ACL', 'LIST']]);
  } finally {
    await server.close();
  }
});

test('combined provider layers route both resources and exclusive ACL writes to their instance', async () => {
  const seats = await providerServer('seat');
  try {
    const cache = await providerServer('cache');
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const acl = yield* ValkeyAclFile.Provider;
          const instance = yield* ValkeyInstance.Provider;
          for (const [name, server, user] of [
            ['seats', seats, 'seat'],
            ['cache', cache, 'cache'],
          ] as const) {
            const props = { instance: name, users: {}, exclusive: true };
            const read = yield* required(acl.read)({ ...context, olds: props, output: undefined });
            expect(Object.keys(required(read).users)).toEqual([user]);
            const before = server.fake.commands.length;
            yield* required(instance.read)({
              ...context,
              olds: { name, port: server.port },
              output: undefined,
            });
            expect(server.fake.commands.slice(before).map(({ args }) => args[0])).toEqual([
              'INFO',
              'CONFIG',
            ]);
            yield* acl.reconcile({ ...context, news: props, olds: props, output: undefined });
            expect(server.fake.acl.size).toBe(0);
            if (name === 'seats') expect(cache.fake.acl.has('cache')).toBe(true);
          }
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              valkeyProviders(config('seats', seats.port)),
              valkeyProviders(config('cache', cache.port)),
            ),
          ),
        ),
      );
    } finally {
      await cache.close();
    }
  } finally {
    await seats.close();
  }
});

test('named connection selection survives either layer order without a listener', async () => {
  const layers = [
    valkeyProviders(config('seats', 56380)),
    valkeyProviders(config('cache', 56381)),
  ] as const;
  for (const providers of [Layer.mergeAll(...layers), Layer.mergeAll(layers[1], layers[0])]) {
    await Effect.runPromise(
      Effect.gen(function* () {
        expect((yield* resolveValkeyConnection('seats')).port).toBe(56380);
        expect((yield* resolveValkeyConnection('cache')).port).toBe(56381);
        const provider = yield* ValkeyAclFile.Provider;
        const error = yield* Effect.flip(
          required(provider.read)({
            ...context,
            olds: { instance: 'typo', users: {} },
            output: undefined,
          }),
        );
        expect(error._tag).toBe('ValkeyConnectionMissing');
        expect(error.instance).toBe('typo');
      }).pipe(Effect.provide(providers)),
    );
  }
});

test('refused socket acquisition maps all ACL operations to ValkeyInstanceUnreachable', async () => {
  const server = await providerServer('seat');
  const port = server.port;
  await server.close();
  await Effect.runPromise(
    Effect.gen(function* () {
      const provider = yield* ValkeyAclFile.Provider;
      const props = { instance: 'seats', users: {} };
      for (const operation of [
        required(provider.read)({ ...context, olds: props, output: undefined }),
        provider.reconcile({ ...context, news: props, olds: props, output: undefined }),
        provider.delete({ ...context, olds: props, output: props }),
      ]) {
        const error = yield* Effect.flip(operation);
        expect(error).toMatchObject({
          _tag: 'ValkeyInstanceUnreachable',
          instance: 'seats',
          host: '127.0.0.1',
          port,
        });
      }
    }).pipe(Effect.provide(valkeyProviders(config('seats', port)))),
  );
});
