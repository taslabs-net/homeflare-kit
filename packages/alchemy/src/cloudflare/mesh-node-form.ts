/**
 * `Cloudflare.MeshNode` — its props, its attributes, and the pure `diff` that decides between
 * update and replace.
 *
 * ⛔ THE ATTRIBUTES NEVER HOLD THE NODE TOKEN. That is the whole reason this resource exists:
 *   Alchemy beta.79's `Cloudflare.Tunnel.WarpConnector` calls `getTunnelWarpConnectorToken` in
 *   `toAttributes`, so EVERY read, reconcile and list fetches the token, and Alchemy state (which
 *   is not encrypted) stores it — `Redacted` hides it from logs, not from the state store. It also
 *   has no `ha` prop. The token is a runtime credential: fetch it on demand with
 *   `fetchMeshNodeToken` (mesh-node-token.ts) and write it straight to the host.
 * ★ A BONUS OF NOT READING IT: the token endpoint needs a Write permission ("Cloudflare One
 *   Connectors Write", per its API reference, read 2026-09-21), so a plan over this resource can
 *   run on a read-only token. WarpConnector's cannot.
 */
import type { Diff } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import { MeshNodeError, type MeshNodeStatus } from './mesh-node-api.ts';

export interface MeshNodeProps {
  /**
   * The node's name in the account — and its identity when adopting (names are unique per
   * account). ★ Changing it RENAMES the node in place (`PATCH`): the id, the token, the
   *   enrolled replicas and their Mesh IPs all survive, so a rename never re-enrols a host.
   */
  readonly name: string;
  /**
   * High availability (active-passive replicas sharing one node token).
   *
   * ⛔ CREATE-ONLY, AND REQUIRED FOR THAT REASON. Cloudflare's Mesh HA page: "High availability
   *   is set at node creation time and cannot be changed afterward." The PATCH body carries no
   *   `ha`. So a change REPLACES the node — a new id, a new token, a new Mesh IP per replica —
   *   and a default would silently fix an irreversible choice. The API's own default is `false`;
   *   the dashboard's is `true`. Say which one you mean.
   * ⚠️ `ha` NEEDS MASQUE on the node's device profile, and a node without routes gains little
   *   from it: each replica keeps its own Mesh IP (same page, "When to use").
   */
  readonly ha: boolean;
}

export interface MeshNodeAttributes {
  /** The node's UUID (the `warp_connector` tunnel id). Pass it to `fetchMeshNodeToken`. */
  readonly id: string;
  /** The account the provider environment resolved when the node was written. */
  readonly accountId: string;
  readonly name: string;
  /** As of the last read or write; it moves on its own as replicas connect and drop. */
  readonly status: MeshNodeStatus | undefined;
  /**
   * The value the node was CREATED with (or declared with when adopted — see mesh-node.md).
   * ⚠️ No documented read returns it: `GET /warp_connector/{id}` has no `ha` field (API
   *   reference, read 2026-09-21), so drift here cannot be observed, only prevented.
   */
  readonly ha: boolean;
}

/** ⛔ Fail closed on a declaration the API would accept but nobody meant. */
export const validateMeshNode = (props: MeshNodeProps): MeshNodeError | undefined => {
  if (typeof props.name !== 'string' || props.name.trim().length === 0) {
    return new MeshNodeError({ message: 'MeshNode `name` must be a non-empty string.' });
  }
  if (props.name !== props.name.trim()) {
    return new MeshNodeError({
      message: `MeshNode name "${props.name}" has leading or trailing whitespace; adoption matches names exactly.`,
    });
  }
  if (typeof props.ha !== 'boolean') {
    return new MeshNodeError({
      message: 'MeshNode `ha` must be true or false. It is create-only, so it has no default.',
    });
  }
  return undefined;
};

/**
 * update or replace, from the declaration and what was last written.
 *
 * - Account changed → `replace`, create-first: names are unique per ACCOUNT, so the two
 *   generations cannot collide.
 * - `ha` changed → `replace`. ⛔ `deleteFirst` when the name stays the same: the new node needs
 *   the name the old one holds, so create-first would fail with code 1013 (or, worse, a
 *   create path that "converged" on the old node would record an `ha` it does not have).
 *   Create-first when the name changes in the same edit, because then nothing collides.
 * - Name changed alone → `update` (a PATCH rename).
 * - Otherwise → no opinion; the engine compares props.
 *
 * ★ An unresolved `ha` gives no answer here; `reconcile` re-checks it once resolved and refuses
 *   rather than updating across a create-only change. An unresolved `name` next to a changed `ha`
 *   counts as "unchanged", which picks the delete-first order that cannot collide.
 */
export const diffMeshNode = (
  news: Input<MeshNodeProps>,
  output: MeshNodeAttributes | undefined,
  accountId: string,
): Diff | undefined => {
  if (output === undefined) return undefined;
  if (output.accountId !== accountId) return { action: 'replace' };
  const fields = news as { readonly name?: unknown; readonly ha?: unknown };
  const name = typeof fields.name === 'string' ? fields.name : undefined;
  if (typeof fields.ha === 'boolean' && fields.ha !== output.ha) {
    const sameName = name === undefined || name === output.name;
    return sameName ? { action: 'replace', deleteFirst: true } : { action: 'replace' };
  }
  if (name !== undefined && name !== output.name) return { action: 'update' };
  return undefined;
};
