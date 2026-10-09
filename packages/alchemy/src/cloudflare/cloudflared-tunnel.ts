/**
 * `Cloudflare.CloudflaredTunnel` — a Cloudflare Tunnel (the cloudflared kind, `cfd_tunnel`),
 * declared without its connector token ever touching Alchemy state. Usage: docs/cloudflared-tunnel.md.
 *
 * 🔴 WHY THIS EXISTS ALONGSIDE `Cloudflare.Tunnel.Tunnel`. Alchemy beta.81's resource stores the
 *   token as a `Redacted` attribute, and the state encoder writes it out in plaintext. See
 *   cloudflared-tunnel-form.ts, which also says what this resource leaves to other declarations.
 *
 * ★ REMOVAL POLICY: `retain` BY DEFAULT — see the ★ on `CloudflaredTunnel` below.
 */
import { Credentials } from '@distilled.cloud/cloudflare/Credentials';
import * as Cloudflare from 'alchemy/Cloudflare';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import { Resource, type ResourceClass } from 'alchemy/Resource';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as HttpClient from 'effect/http/HttpClient';
import {
  type CloudflaredTunnelAttributes,
  type CloudflaredTunnelProps,
  diffCloudflaredTunnel,
  validateCloudflaredTunnel,
} from './cloudflared-tunnel-form.ts';
import {
  deleteCloudflaredTunnel,
  readCloudflaredTunnel,
  reconcileCloudflaredTunnel,
} from './cloudflared-tunnel-lifecycle.ts';
import type { Providers } from './providers.ts';

export interface CloudflaredTunnel extends Resource<
  'Cloudflare.CloudflaredTunnel',
  CloudflaredTunnelProps,
  CloudflaredTunnelAttributes,
  never,
  Providers
> {}

/**
 * ★ `defaultRemovalPolicy: 'retain'`, LIKE EVERY KIT RESOURCE WHOSE DELETION BREAKS ITS CONSUMERS
 *   (MeshNode, the `Bao.*` families, `R2BucketLock`; the reasoning is written once in
 *   proxmox/resource.ts). Deleting a tunnel drops its remote configuration (ingress rules) and
 *   orphans every DNS record that targets `<id>.cfargotunnel.com`, and a new tunnel has a new id
 *   and a new token. So dropping the declaration, or `alchemy destroy`, leaves the tunnel live.
 * ⚠️ IT ALSO SKIPS THE OLD TUNNEL'S DELETE IN AN ACCOUNT-CHANGE REPLACE (create-first), which
 *   leaves the old tunnel live and unmanaged (Apply.ts, `deleteOldGenerations`, beta.81).
 * ⛔ `delete` STAYS FULLY IMPLEMENTED. Retain is Terraform's `prevent_destroy`, not a stub: it runs
 *   the moment a declaration opts in with `.pipe(RemovalPolicy.destroy())`.
 */
export const CloudflaredTunnel: ResourceClass<CloudflaredTunnel> = Resource<CloudflaredTunnel>(
  'Cloudflare.CloudflaredTunnel',
  { defaultRemovalPolicy: 'retain' },
);

/** What every call below needs: the account, credentials and HTTP — Alchemy's own trio. */
export type CloudflaredTunnelServices =
  | Cloudflare.CloudflareEnvironment
  | Credentials
  | HttpClient.HttpClient;

/** The account id, resolved the way every `alchemy/Cloudflare` provider resolves it. */
const accountId = Effect.gen(function* () {
  const resolved = yield* yield* Cloudflare.CloudflareEnvironment;
  return resolved.accountId;
});

/**
 * ★ `Provider.effect`, CAPTURING THE THREE SERVICES AT BUILD, exactly as `MeshNodeProvider` does
 *   (mesh-node.ts says why): correct whether or not the stack also merges `Cloudflare.providers()`.
 */
export const CloudflaredTunnelProvider = () =>
  Provider.effect(
    CloudflaredTunnel,
    Effect.gen(function* () {
      const services = Context.make(
        Cloudflare.CloudflareEnvironment,
        yield* Cloudflare.CloudflareEnvironment,
      ).pipe(
        Context.add(Credentials, yield* Credentials),
        Context.add(HttpClient.HttpClient, yield* HttpClient.HttpClient),
      );
      const run = <A, E>(effect: Effect.Effect<A, E, CloudflaredTunnelServices>) =>
        Effect.provideContext(effect, services);

      return CloudflaredTunnel.Provider.of({
        stables: ['id', 'accountId'],
        /**
         * ⛔ EMPTY, AND `nuke.skip`. Alchemy's own `Cloudflare.Tunnel.Tunnel` already lists every
         *   `cfd_tunnel` in the account for `alchemy unsafe nuke` (and fetches each token to do
         *   it); a second listing here would make nuke delete each tunnel twice. `read` does not
         *   depend on this.
         */
        list: () => Effect.succeed([]),
        nuke: { skip: true },
        /** ⛔ Validate at plan time too, so a bad declaration never reaches a replace. */
        diff: ({ news, output }) =>
          run(
            Effect.gen(function* () {
              const invalid = isResolved(news) ? validateCloudflaredTunnel(news) : undefined;
              if (invalid !== undefined) return yield* Effect.fail(invalid);
              return diffCloudflaredTunnel(news, output, yield* accountId);
            }),
          ),
        read: ({ olds, output }) =>
          run(Effect.flatMap(accountId, (account) => readCloudflaredTunnel(account, olds, output))),
        reconcile: ({ news, output }) =>
          run(
            Effect.flatMap(accountId, (account) =>
              reconcileCloudflaredTunnel(account, news, output),
            ),
          ),
        delete: ({ output }) => run(deleteCloudflaredTunnel(output)),
      });
    }),
  );
