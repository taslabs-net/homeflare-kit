/**
 * `Valkey.Instance` — assert-and-read over a running Valkey server, reached over RESP.
 *
 * ⛔ ADOPT-AND-ASSERT, NEVER CREATE OR RECONFIGURE. The instance itself is a container the
 *   `Podman.Container` family owns (`homeflare-ct100/src/valkey.ts` declares the two dormant
 *   Quadlets). This resource reads `INFO` and `CONFIG GET` to confirm the live instance matches the
 *   declaration, and refuses drift — it never issues `CONFIG SET` (which could drop in-flight
 *   data) and never starts a process.
 * ⛔ `delete` NEVER STOPS AN INSTANCE. `ValkeyInstanceDeleteRefused` and
 *   `defaultRemovalPolicy: 'retain'` are two independent reasons the engine never shuts a server
 *   down through this provider.
 * ★ NO OWNERSHIP MARK (H1). `read` always answers `Unowned` for a match, the same rule
 *   `Postgres.Database` uses, so every already-live instance needs `adopt(true)` in the stack
 *   that declares it.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import { type ValkeyConnection, withValkey } from './connection.ts';
import { type ValkeyError, ValkeyInstanceDrift } from './errors.ts';
import { type ValkeyInstanceAttributes, type ValkeyInstanceProps } from './instance-attrs.ts';
import { buildAttributes, firstDrift, parseInfo } from './instance-form.ts';
import {
  type ValkeyExecutor,
  ValkeyServerError,
  type ValkeyTransportError,
  arrayPairs,
} from './transport.ts';

export interface ValkeyInstance extends Resource<
  'Valkey.Instance',
  ValkeyInstanceProps,
  ValkeyInstanceAttributes
> {}

export const ValkeyInstance = Resource<ValkeyInstance>('Valkey.Instance', {
  defaultRemovalPolicy: 'retain',
});

export const isValkeyInstance = (value: unknown): value is ValkeyInstance =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  (value as { Type?: unknown }).Type === 'Valkey.Instance';

/** `delete` never stops an instance; dropping a server is a human act on the host. */
export class ValkeyInstanceDeleteRefused extends Data.TaggedError('ValkeyInstanceDeleteRefused')<{
  readonly instance: string;
}> {
  override get message(): string {
    return (
      `Valkey.Instance "${this.instance}": delete is refused. This provider never stops a ` +
      'running Valkey server. Stop it by hand on the host if you mean to remove it, then remove ' +
      'the declaration.'
    );
  }
}

export type ValkeyInstanceError = ValkeyError | ValkeyInstanceDeleteRefused;

/** Read the live instance: `INFO` then `CONFIG GET`, folded into attributes. */
export const readWithExecutor = (
  executor: ValkeyExecutor,
  props: Pick<ValkeyInstanceProps, 'name' | 'port'>,
): Effect.Effect<ValkeyInstanceAttributes, ValkeyTransportError> =>
  Effect.gen(function* () {
    const infoReply = yield* executor.send(['INFO']);
    if (infoReply.kind === 'error') {
      return yield* Effect.fail(new ValkeyServerError({ detail: infoReply.message }));
    }
    const info = parseInfo(infoReply.kind === 'bulk' ? infoReply.value : null);
    const configReply = yield* executor.send([
      'CONFIG',
      'GET',
      'maxmemory',
      'maxmemory-policy',
      'appendonly',
    ]);
    if (configReply.kind === 'error') {
      return yield* Effect.fail(new ValkeyServerError({ detail: configReply.message }));
    }
    const pairs = configReply.kind === 'array' ? arrayPairs(configReply.values) : new Map();
    return buildAttributes(props, info, {
      maxmemory: pairs.get('maxmemory') ?? undefined,
      maxmemoryPolicy: pairs.get('maxmemory-policy') ?? undefined,
      appendonly: pairs.get('appendonly') ?? undefined,
    });
  });

/**
 * The five lifecycle handlers. Exported separately from the provider layer so tests can call
 * `valkeyInstanceHandlers.read(...)` directly against the real implementation without standing up
 * the engine's provider machinery.
 */
export const makeValkeyInstanceHandlers = (
  connect: typeof withValkey = withValkey,
): Provider.ProviderService<
  ValkeyInstance,
  ValkeyConnection,
  never,
  never,
  ValkeyConnection,
  ValkeyConnection
> =>
  ValkeyInstance.Provider.of({
    // ⚠️ EMPTY, NOT A LIVE SWEEP. A Valkey has no instance enumeration; adoption is one
    //   declaration at a time, matching `Postgres.Database`.
    list: () => Effect.succeed([]),
    nuke: { skip: true },

    read: ({ output, olds }) =>
      Effect.gen(function* () {
        const props = output ?? olds;
        // Neither AUTH failure nor an unreachable endpoint proves absence. Propagate the
        // typed failure so Plan.ts cannot bypass the adoption gate with a CREATE.
        return yield* connect(
          (ex) => Effect.map(readWithExecutor(ex, { name: props.name, port: props.port }), Unowned),
          props.name,
        );
      }),

    diff: ({ news, output }) =>
      Effect.sync(() => {
        if (!isResolved(news)) return undefined;
        if (output === undefined) return undefined;
        const drift = firstDrift(news, output);
        return drift !== undefined
          ? ({ action: 'update' } as const)
          : ({ action: 'noop' } as const);
      }),

    reconcile: ({ news }) =>
      Effect.gen(function* () {
        const live = yield* connect(
          (ex) => readWithExecutor(ex, { name: news.name, port: news.port }),
          news.name,
        );
        const drift = firstDrift(news, live);
        if (drift !== undefined) {
          return yield* Effect.fail(
            new ValkeyInstanceDrift({
              instance: news.name,
              prop: drift.prop,
              declared: drift.declared,
              live: drift.live,
            }),
          );
        }
        return live;
      }),

    delete: ({ olds }) => Effect.fail(new ValkeyInstanceDeleteRefused({ instance: olds.name })),
  });

export const valkeyInstanceHandlers = makeValkeyInstanceHandlers();

export const ValkeyInstanceProvider = () =>
  Provider.succeed(ValkeyInstance, valkeyInstanceHandlers);
