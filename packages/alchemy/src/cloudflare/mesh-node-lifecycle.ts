/**
 * read / reconcile / delete for `Cloudflare.MeshNode`, as plain Effects over the SDK calls in
 * mesh-node-api.ts. mesh-node.ts only wires them into Alchemy.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import * as Effect from 'effect/Effect';
import {
  MeshNodeError,
  type ObservedNode,
  createNode,
  deleteNode,
  findNodeByName,
  getNode,
  renameNode,
} from './mesh-node-api.ts';
import { type MeshNodeAttributes, type MeshNodeProps, validateMeshNode } from './mesh-node-form.ts';

const attributesOf = (node: ObservedNode, accountId: string, ha: boolean): MeshNodeAttributes => ({
  id: node.id,
  accountId,
  name: node.name,
  status: node.status,
  ha,
});

/**
 * Owned: refresh by the stored id. Cold: find the live node by exact name and hand it back
 * `Unowned`, so Alchemy refuses to take it over until the stack says `adopt(true)` — the same
 * gate `Cloudflare.Tunnel.WarpConnector` uses, because a `warp_connector` carries no ownership
 * marker to prove it was ours.
 *
 * ⚠️ ADOPTION RECORDS THE DECLARED `ha`, BECAUSE NOTHING ELSE CAN. No documented read returns a
 *   node's HA flag. Adopting an existing node with the wrong `ha` records the wrong value, and no
 *   later plan can notice. Check the node's HA badge in the dashboard before adopting.
 */
export const readMeshNode = (
  accountId: string,
  olds: MeshNodeProps | undefined,
  output: MeshNodeAttributes | undefined,
) =>
  Effect.gen(function* () {
    const account = output?.accountId ?? accountId;
    if (output !== undefined) {
      const node = yield* getNode(account, output.id);
      if (node !== undefined) return attributesOf(node, account, output.ha);
    }
    const name = olds?.name ?? output?.name;
    const ha = olds?.ha ?? output?.ha;
    if (name === undefined || ha === undefined) return undefined;
    const match = yield* findNodeByName(account, name);
    return match === undefined ? undefined : Unowned(attributesOf(match, account, ha));
  });

/**
 * ⛔ NEVER CONVERGE ON A NODE THIS RESOURCE DID NOT FIND BY ITS OWN ID. Alchemy's WarpConnector
 *   answers `DuplicateTunnelName` by re-reading the node that holds the name and returning it.
 *   Here that would be wrong in exactly the case that matters: an `ha` replace whose old node is
 *   still alive (a `retain` removal policy skips the delete-first teardown) would "create" by
 *   silently re-using the old node and record the new `ha` on it. Adoption belongs to `read` and
 *   `adopt(true)`; an interrupted create is recovered by the engine through `read` too.
 */
const nameTaken = (name: string, holder: string) =>
  new MeshNodeError({
    message:
      `A Mesh node named "${name}" already exists (${holder}) and this stack did not create it. ` +
      'Adopt it with adopt(true) if it is meant to be this one. If it is the old generation of ' +
      'an `ha` replace kept by a `retain` removal policy, delete it first: HA cannot be changed ' +
      'in place, and names are unique per account.',
  });

const createFresh = (accountId: string, news: MeshNodeProps) =>
  Effect.gen(function* () {
    const existing = yield* findNodeByName(accountId, news.name);
    if (existing !== undefined) return yield* Effect.fail(nameTaken(news.name, existing.id));
    // ⚠️ code 1013 without a live warp_connector of that name: another tunnel TYPE may hold it
    //   (a cloudflared tunnel), one was created after the lookup above, or — UNMEASURED — a node
    //   deleted moments ago (a delete-first `ha` replace) may still reserve its name.
    const node = yield* createNode(accountId, news.name, news.ha).pipe(
      Effect.catchTag('DuplicateTunnelName', () =>
        Effect.fail(
          nameTaken(news.name, 'not a live Mesh node: another tunnel type, or a just-deleted node'),
        ),
      ),
    );
    return attributesOf(node, accountId, news.ha);
  });

export const reconcileMeshNode = (
  accountId: string,
  news: MeshNodeProps,
  output: MeshNodeAttributes | undefined,
) =>
  Effect.gen(function* () {
    const invalid = validateMeshNode(news);
    if (invalid !== undefined) return yield* Effect.fail(invalid);
    const owned = output !== undefined && output.accountId === accountId ? output : undefined;
    const live = owned === undefined ? undefined : yield* getNode(accountId, owned.id);
    // ★ Gone out of band (or a replace's new generation): create, under the same refusals.
    if (owned === undefined || live === undefined) return yield* createFresh(accountId, news);
    if (owned.ha !== news.ha) {
      // ⛔ The plan would have said `replace`; it can only reach here with `ha` unresolved then.
      return yield* Effect.fail(
        new MeshNodeError({
          message: `MeshNode "${news.name}": \`ha\` is create-only (stored ${owned.ha}, declared ${news.ha}). Plan again so the change is a replace.`,
        }),
      );
    }
    if (live.name === news.name) return attributesOf(live, accountId, owned.ha);
    const renamed = yield* renameNode(accountId, live.id, news.name).pipe(
      Effect.catchTag('DuplicateTunnelName', () =>
        Effect.fail(nameTaken(news.name, 'held by another tunnel')),
      ),
    );
    return attributesOf(renamed, accountId, owned.ha);
  });

/**
 * ⚠️ Cloudflare may refuse to delete a node while replicas are connected (Alchemy's WarpConnector
 *   notes "Deleting requires all connector sessions to be down"; unmeasured here). Stop the
 *   client on every replica first. A node already gone is a successful delete.
 */
export const deleteMeshNode = (output: MeshNodeAttributes) =>
  deleteNode(output.accountId, output.id);
