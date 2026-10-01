/** Named connections keep each resource on its own server when provider layers are combined. */
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import type { ValkeyConnectionConfig } from './connection.ts';

export class ValkeyConnectionMissing extends Data.TaggedError('ValkeyConnectionMissing')<{
  readonly instance: string;
}> {
  override get message(): string {
    return `Valkey connection for "${this.instance}" is missing; configure that instance in valkeyProviders.`;
  }
}

/** The unnamed service is only for direct transport calls; resources always select a name. */
export class ValkeyConnection extends Context.Service<
  ValkeyConnection,
  Effect.Effect<ValkeyConnectionConfig>
>()('Valkey.Connection') {}

const connectionService = (
  instance?: string,
): Context.Service<ValkeyConnection, Effect.Effect<ValkeyConnectionConfig>> =>
  instance === undefined
    ? ValkeyConnection
    : Context.Service<ValkeyConnection, Effect.Effect<ValkeyConnectionConfig>>(
        `Valkey.Connection:${instance}`,
      );

/** Use `Layer.provideMerge` on providers: their handlers resolve this service later. */
export const valkeyConnection = (config: ValkeyConnectionConfig): Layer.Layer<ValkeyConnection> =>
  Layer.succeed(connectionService(config.instance), Effect.succeed(config));

export const resolveValkeyConnection = (
  instance?: string,
): Effect.Effect<ValkeyConnectionConfig, ValkeyConnectionMissing, ValkeyConnection> =>
  Effect.gen(function* () {
    // No unnamed fallback: a typo must never send a seat ACL to another instance's cache.
    const service = yield* Effect.serviceOption(connectionService(instance));
    if (Option.isNone(service)) {
      return yield* Effect.fail(new ValkeyConnectionMissing({ instance: instance ?? '<unnamed>' }));
    }
    return yield* service.value;
  });
