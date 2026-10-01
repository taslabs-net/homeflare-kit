/**
 * The Valkey provider, pre-wired to one instance:
 *
 *     const providers = valkeyProviders({ instance: 'valkey-seats', host: '127.0.0.1', port: 6381 });
 *
 * ★ THE INSTANCE IS A PARAMETER, NOT A DEFAULT (S15). This kit is PUBLIC; CT100's host, the two
 *   ports (6380/6381) and the ACL user a seat authenticates as are the CONSUMING stack's values,
 *   never baked in here. Each resource selects the connection by its instance name, so the
 *   fixed provider tags cannot redirect one instance's ACL to another server.
 */
import * as Layer from 'effect/Layer';
import { ValkeyAclFileProvider } from './acl.ts';
import { type ValkeyConnectionConfig, valkeyConnection } from './connection.ts';
import { ValkeyInstanceProvider } from './instance.ts';

// ⚠️ As in postgres/providers.ts and caddy/providers.ts, plain provide hides the connection
//   from lifecycle handlers invoked later by Alchemy. Keep the named service in the output.
export const valkeyProviders = (config: ValkeyConnectionConfig & { readonly instance: string }) =>
  Layer.mergeAll(ValkeyInstanceProvider(), ValkeyAclFileProvider()).pipe(
    Layer.provideMerge(valkeyConnection(config)),
  );
