/** Map the whole connection operation, including socket acquisition and AUTH transport errors. */
import * as Effect from 'effect/Effect';
import { resolveValkeyConnection } from './connection-service.ts';
import { ValkeyInstanceUnreachable } from './errors.ts';
import type { ValkeySocketError } from './transport.ts';

export const aclUnreachable = (instance: string) => (_error: ValkeySocketError) =>
  Effect.gen(function* () {
    const config = yield* resolveValkeyConnection(instance);
    return yield* Effect.fail(
      new ValkeyInstanceUnreachable({ instance, host: config.host, port: config.port }),
    );
  });
