/**
 * The `warp_connector` calls a Cloudflare Mesh node needs, and nothing else.
 *
 * ★ A MESH NODE IS A `warp_connector` OBJECT. Cloudflare's Mesh docs create one with
 *   `POST /accounts/{account_id}/warp_connector` and fetch its enrolment token from
 *   `GET …/warp_connector/{id}/token` (developers.cloudflare.com/mesh/get-started, read
 *   2026-09-21). There is no separate "mesh node" endpoint.
 *
 * ★ OVER `@distilled.cloud/cloudflare`, THE SDK ALCHEMY'S OWN CLOUDFLARE PROVIDERS USE, not the
 *   `cloudflare` npm SDK the R2 lock uses. Measured 2026-09-21: `cloudflare@4.5.0`'s
 *   `WARPConnectorCreateParams` has only `account_id` and `name`, so it cannot create an HA node.
 *   distilled `1.0.0-rc.12` (the version alchemy@2.0.0-beta.79 pins) has `ha?: boolean` on
 *   `CreateTunnelWarpConnectorRequest`, typed errors (`TunnelNotFound` code 1002 / 404,
 *   `DuplicateTunnelName` code 1013), and resolves credentials and the account exactly the way
 *   `Cloudflare.Tunnel.WarpConnector` and `Cloudflare.Gateway.Rule` do — so the node and the Gateway
 *   rules that pin its Mesh IP always land in the same account.
 *
 * ⛔ NO FUNCTION IN THIS FILE READS THE NODE TOKEN, and `observe` copies named fields only. The
 *   HA docs say the create response carries a `token` field; distilled's decoder copies only the
 *   fields in its schema (protocol.ts, `getProps(outputAst)`), and `observe` below would drop it
 *   again if it ever got through. The one token read lives in mesh-node-token.ts, on demand.
 */
import * as zeroTrust from '@distilled.cloud/cloudflare/zero-trust';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Stream from 'effect/Stream';

/** `inactive` (never run), `degraded`, `healthy` or `down` — Cloudflare's own four. */
export type MeshNodeStatus = 'inactive' | 'degraded' | 'healthy' | 'down';

/** A live node as this package sees it. ⛔ There is no token field here, on purpose. */
export interface ObservedNode {
  readonly id: string;
  readonly name: string;
  readonly status: MeshNodeStatus | undefined;
}

/** A refusal or failure, carrying the sentence an operator needs. Never a token. */
export class MeshNodeError extends Data.TaggedError('MeshNodeError')<{
  readonly message: string;
}> {}

type Raw = {
  readonly id?: string | null;
  readonly name?: string | null;
  readonly status?: string | null;
  readonly deletedAt?: string | null;
};

const STATUSES: readonly string[] = ['inactive', 'degraded', 'healthy', 'down'];

/**
 * ⚠️ A DELETED NODE IS NOT A NODE. Cloudflare keeps deleted tunnels (every response carries
 *   `deleted_at`, and the list takes `is_deleted`), so a `GET` by id can answer for one. Treating
 *   that as live would "adopt" a tombstone and PATCH it.
 */
export const observe = (raw: Raw): ObservedNode | undefined => {
  if (typeof raw.id !== 'string' || raw.id.length === 0) return undefined;
  if (raw.deletedAt !== undefined && raw.deletedAt !== null) return undefined;
  const status =
    typeof raw.status === 'string' && STATUSES.includes(raw.status)
      ? (raw.status as MeshNodeStatus)
      : undefined;
  return { id: raw.id, name: raw.name ?? '', status };
};

/** The node with this id, or `undefined` when it is gone (404 / code 1002, or soft-deleted). */
export const getNode = (accountId: string, nodeId: string) =>
  zeroTrust.getTunnelWarpConnector({ accountId, tunnelId: nodeId }).pipe(
    Effect.map(observe),
    Effect.catchTag('TunnelNotFound', () => Effect.succeed(undefined)),
  );

/**
 * The live node with exactly this name, or `undefined`.
 *
 * ★ `name` is also sent as the list filter, but the match is re-checked here: the filter's
 *   exactness is not documented, and a prefix match would adopt the wrong node.
 * ⛔ Two live matches is refused rather than resolved. Names are unique per account (the create
 *   answers code 1013 otherwise), so two means something this package does not understand.
 */
export const findNodeByName = (accountId: string, name: string) =>
  zeroTrust.listTunnelWarpConnectors.items({ accountId, name, isDeleted: false }).pipe(
    Stream.map(observe),
    Stream.filter((node): node is ObservedNode => node !== undefined && node.name === name),
    Stream.runCollect,
    Effect.flatMap((chunk) => {
      const matches = Array.from(chunk);
      if (matches.length <= 1) return Effect.succeed(matches[0]);
      const ids = matches.map((node) => node.id).join(', ');
      return Effect.fail(
        new MeshNodeError({
          message: `Mesh node name "${name}" matches ${matches.length} live nodes (${ids}). Names are unique per account, so refusing to guess which one is meant.`,
        }),
      );
    }),
  );

/**
 * ⛔ `ha` IS SENT ON CREATE AND NOWHERE ELSE. Cloudflare's HA page: "High availability is set at
 *   node creation time and cannot be changed afterward." The PATCH body (`PatchTunnelWarpConnector
 *   Request`) has only `name` and `tunnelSecret`.
 */
export const createNode = (accountId: string, name: string, ha: boolean) =>
  zeroTrust.createTunnelWarpConnector({ accountId, name, ha }).pipe(
    Effect.flatMap((raw) => {
      const node = observe(raw);
      return node === undefined
        ? Effect.fail(
            new MeshNodeError({ message: `Creating Mesh node "${name}" returned no id.` }),
          )
        : Effect.succeed(node);
    }),
  );

/** ★ A rename is a PATCH: same id, same token, same enrolled replicas and Mesh IP. */
export const renameNode = (accountId: string, nodeId: string, name: string) =>
  zeroTrust
    .patchTunnelWarpConnector({ accountId, tunnelId: nodeId, name })
    .pipe(Effect.map((raw) => observe(raw) ?? { id: nodeId, name, status: undefined }));

/** Idempotent: a node already gone (404 / code 1002) is a successful delete. */
export const deleteNode = (accountId: string, nodeId: string) =>
  zeroTrust.deleteTunnelWarpConnector({ accountId, tunnelId: nodeId }).pipe(
    Effect.asVoid,
    Effect.catchTag('TunnelNotFound', () => Effect.void),
  );
