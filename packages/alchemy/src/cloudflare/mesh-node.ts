/**
 * `Cloudflare.MeshNode` — a Cloudflare Mesh node (a `warp_connector` object), declared without
 * its token ever touching Alchemy state. Usage and the enrolment step: docs/mesh-node.md.
 *
 * 🔴 WHY THIS EXISTS ALONGSIDE `Cloudflare.Tunnel.WarpConnector`. A Mesh node that fronts a
 *   private service needs a node record in the graph, so the Gateway rules and DNS records that
 *   name it deploy together. Alchemy beta.79's WarpConnector would put the node token — the
 *   credential that lets any Linux host join the account's Mesh as that node — into plaintext
 *   state on every read, and it cannot create an HA node. See mesh-node-form.ts.
 *
 * ★ REMOVAL POLICY: `retain` BY DEFAULT — see the ★ on `MeshNode` below, and what it does to an
 *   `ha` replace in mesh-node-lifecycle.ts.
 */
import { Credentials } from '@distilled.cloud/cloudflare/Credentials';
import * as Cloudflare from 'alchemy/Cloudflare';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import { Resource, type ResourceClass } from 'alchemy/Resource';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import {
  type MeshNodeAttributes,
  type MeshNodeProps,
  diffMeshNode,
  validateMeshNode,
} from './mesh-node-form.ts';
import { deleteMeshNode, readMeshNode, reconcileMeshNode } from './mesh-node-lifecycle.ts';
import type { Providers } from './providers.ts';

export interface MeshNode extends Resource<
  'Cloudflare.MeshNode',
  MeshNodeProps,
  MeshNodeAttributes,
  never,
  Providers
> {}

/**
 * ★ `defaultRemovalPolicy: 'retain'`, LIKE EVERY KIT RESOURCE WHOSE DELETION BREAKS ITS CONSUMERS
 *   (the `Bao.*` families, `R2BucketLock`, the Proxmox storage families; the reasoning is written
 *   once in proxmox/resource.ts). Deleting a node cuts every enrolled replica off the Mesh, and
 *   nothing brings it back: a new node has a new id, a new token and a new Mesh IP per replica, so
 *   each host must be re-enrolled by hand and every Gateway rule or allow-list that pins the old
 *   Mesh IP breaks. So dropping the declaration, or `alchemy destroy`, leaves the node live.
 * ⚠️ IT ALSO SKIPS THE OLD NODE'S DELETE IN A REPLACE (Apply.ts, `deleteOldGenerations` and the
 *   GC's `retainOldGeneration`, beta.79). A same-name `ha` change therefore REFUSES, deleting
 *   nothing, until that deploy opts in with `.pipe(RemovalPolicy.destroy())`; a create-first
 *   replace leaves the old node live and unmanaged. Both measured in mesh-node-policy.test.ts.
 * ⛔ `delete` STAYS FULLY IMPLEMENTED. Retain is Terraform's `prevent_destroy`, not a stub: it runs
 *   the moment a declaration opts in with `.pipe(RemovalPolicy.destroy())`.
 */
export const MeshNode: ResourceClass<MeshNode> = Resource<MeshNode>('Cloudflare.MeshNode', {
  defaultRemovalPolicy: 'retain',
});

/** What every call below needs: the account, credentials and HTTP — Alchemy's own trio. */
export type MeshNodeServices =
  | Cloudflare.CloudflareEnvironment
  | Credentials
  | HttpClient.HttpClient;

/** The account id, resolved the way every `alchemy/Cloudflare` provider resolves it. */
const accountId = Effect.gen(function* () {
  const resolved = yield* yield* Cloudflare.CloudflareEnvironment;
  return resolved.accountId;
});

/**
 * ★ `Provider.effect`, CAPTURING THE THREE SERVICES AT BUILD. `Provider.succeed` (what Alchemy's
 *   own providers use) leaves each handler to find CloudflareEnvironment and Credentials in the
 *   engine's context at call time — which works for `Cloudflare.providers()` only because it
 *   `provideMerge`s them into the stack. Capturing them here keeps this provider correct whether
 *   or not the stack also merges `Cloudflare.providers()`.
 */
export const MeshNodeProvider = () =>
  Provider.effect(
    MeshNode,
    Effect.gen(function* () {
      const services = Context.make(
        Cloudflare.CloudflareEnvironment,
        yield* Cloudflare.CloudflareEnvironment,
      ).pipe(
        Context.add(Credentials, yield* Credentials),
        Context.add(HttpClient.HttpClient, yield* HttpClient.HttpClient),
      );
      const run = <A, E>(effect: Effect.Effect<A, E, MeshNodeServices>) =>
        Effect.provideContext(effect, services);

      return MeshNode.Provider.of({
        stables: ['id', 'accountId', 'ha'],
        /**
         * ⛔ EMPTY, AND `nuke.skip`. Alchemy's own `Cloudflare.Tunnel.WarpConnector` already lists
         *   every `warp_connector` in the account for `alchemy unsafe nuke`; a second listing here
         *   would make nuke delete each node twice. `read` does not depend on this.
         */
        list: () => Effect.succeed([]),
        nuke: { skip: true },
        /**
         * ⛔ VALIDATE AT PLAN TIME, NOT ONLY IN `reconcile`. An `ha` replace is delete-first: the
         *   engine deletes the old node BEFORE the new generation's reconcile runs, so a
         *   declaration refused there would leave no node at all. launchd's job-preflight.ts
         *   refuses at plan time for the same reason.
         */
        diff: ({ news, output }) =>
          run(
            Effect.gen(function* () {
              const invalid = isResolved(news) ? validateMeshNode(news) : undefined;
              if (invalid !== undefined) return yield* Effect.fail(invalid);
              return diffMeshNode(news, output, yield* accountId);
            }),
          ),
        read: ({ olds, output }) =>
          run(Effect.flatMap(accountId, (account) => readMeshNode(account, olds, output))),
        reconcile: ({ news, output }) =>
          run(Effect.flatMap(accountId, (account) => reconcileMeshNode(account, news, output))),
        delete: ({ output }) => run(deleteMeshNode(output)),
      });
    }),
  );
