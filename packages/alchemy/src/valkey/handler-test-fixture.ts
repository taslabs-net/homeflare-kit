/** Test-only connection injection: no listener, module mock or live endpoint. */
import * as Effect from 'effect/Effect';
import {
  type ValkeyConnection,
  type ValkeyConnectionConfig,
  auth,
  type withValkey,
} from './connection.ts';
import type { Environment } from '../secrets/write-only.ts';
import type { ValkeyExecutor } from './transport.ts';
import { valkeyConnection } from './connection.ts';

export const config: ValkeyConnectionConfig = {
  host: '127.0.0.1',
  port: 0,
  username: 'admin',
  password: { fromEnv: 'TEST_VALKEY_ADMIN_PW' },
};
export const env: Environment = { TEST_VALKEY_ADMIN_PW: 'FAKE-admin' };
export const connection =
  (executor: ValkeyExecutor, credentials: Environment = env): typeof withValkey =>
  (build) =>
    Effect.gen(function* () {
      yield* auth(executor, config, credentials);
      return yield* build(executor, config);
    });
export const run = <A, E>(effect: Effect.Effect<A, E, ValkeyConnection>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(valkeyConnection(config))));
export const context = {
  id: 'scratch',
  fqn: 'scratch',
  instanceId: 'scratch',
  session: undefined as never,
  bindings: [],
  oldBindings: [],
  newBindings: [],
};

export const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('missing test fixture or handler');
  return value;
};
