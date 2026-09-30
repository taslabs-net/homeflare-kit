/**
 * The Valkey provider, pre-wired to one instance:
 *
 *     const providers = valkeyProviders({ host: '127.0.0.1', port: 6381 });
 *
 * ★ THE INSTANCE IS A PARAMETER, NOT A DEFAULT (S15). This kit is PUBLIC; CT100's host, the two
 *   ports (6380/6381) and the ACL user a seat authenticates as are the CONSUMING stack's values,
 *   never baked in here. A stack with more than one instance calls this more than once and merges
 *   the results.
 */
import * as Layer from 'effect/Layer';
import { ValkeyAclFileProvider } from './acl.ts';
import { type ValkeyConnectionConfig, valkeyConnection } from './connection.ts';
import { ValkeyInstanceProvider } from './instance.ts';

export const valkeyProviders = (config: ValkeyConnectionConfig) =>
  Layer.mergeAll(ValkeyInstanceProvider(), ValkeyAclFileProvider()).pipe(
    Layer.provide(valkeyConnection(config)),
  );
