/**
 * The consumer program for `@homeflare/seat-runtime/state`, as text: smoke.ts writes it into the
 * scratch project beside the root-entry consumer and runs it under bun AND node.
 *
 * ★ NO STORE IS NEEDED. Every layer is built against something that is not there or is wrong, and
 *   what comes back is checked: the subpath resolves through `exports` under both runtimes, the
 *   typed errors are the ones the README promises, and no password is in anything they print.
 *   The Valkey layer fails under node because `Bun.RedisClient` is not there, and under bun because
 *   nothing listens: both are `RedisError`, so one assertion covers both.
 * ⚠️ NEITHER RUNTIME'S GLOBALS, so the same text typechecks with no @types/node or @types/bun.
 */
export const STATE_CONSUMER = `import { Effect, Layer } from 'effect';
import * as ConfigProvider from 'effect/ConfigProvider';
import { SeatState } from '@homeflare/seat-runtime/state';

const secret = 'smoke-secret-value';
const everything = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v instanceof Error
      ? Object.fromEntries(Object.getOwnPropertyNames(v).map((name) => [name, (v as unknown as Record<string, unknown>)[name]]))
      : v,
  );
const failureOf = <A, E>(layer: Layer.Layer<A, E>): Promise<E> =>
  Effect.runPromise(Effect.scoped(Layer.build(layer)).pipe(Effect.flip));

const cases: Array<[string, { _tag: string }, string]> = [
  ['postgres, not a URL', await failureOf(SeatState.postgres({ url: 'not a url ' + secret })), 'SqlError'],
  [
    'postgres, refused',
    await failureOf(SeatState.postgres({ url: 'postgres://u:' + secret + '@127.0.0.1:1/db', connectTimeout: 500 })),
    'SqlError',
  ],
  [
    'valkey, nothing to reach',
    await failureOf(SeatState.valkey({ url: 'redis://u:' + secret + '@127.0.0.1:1', connectionTimeout: 500 })),
    'RedisError',
  ],
  [
    'both, no variables',
    await failureOf(SeatState.layerFromEnv().pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({}))))),
    'ConfigError',
  ],
];
for (const [name, error, tag] of cases) {
  if (error._tag !== tag) throw new Error(name + ': wanted ' + tag + ', got ' + error._tag);
  if (everything(error).includes(secret)) throw new Error(name + ' leaked the password: ' + everything(error));
}
if (SeatState.isPermissionDenied(new Error('NOPERM'))) throw new Error('isPermissionDenied took a plain Error');
console.log('state consumer ok', cases.length, 'typed failures, no password in any');
`;
