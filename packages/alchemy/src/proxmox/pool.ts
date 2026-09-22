/**
 * `Proxmox.Pool` — a PVE resource pool. Guests grouped for permissions and quota.
 *
 * ★ PROVEN END TO END AGAINST THE LIVE CLUSTER, 2026-09-13. create -> verified with `pvesh get
 *   /pools` on the node rather than by believing Alchemy; second plan -> `no changes / noop`; then
 *   the comment was edited ON THE CLUSTER and plan said `1 to update`, and a deploy repaired it.
 *   That drift case is the one that matters: `diff` reads the LIVE pool, so a provider trusting
 *   its own state would have reported noop straight past a hand-edit in the UI.
 *
 * ⚠️ IT 403'd UNTIL THE ROLE WAS WIDENED, AND THE HISTORY IS WORTH KEEPING. `hf-provision@pve`
 *   held the provision role on `/` with no `Pool.Allocate`, so reconcile answered
 *   "Permission check failed (/pool/lab, Pool.Allocate)". The credential could not widen itself
 *   — `PUT /access/roles` is 403 for it too — so the role was extended over SSH with
 *   `pveum role modify <role> --privs "<existing>,Pool.Allocate,Pool.Audit"`, preserving every
 *   existing privilege. `PROVISION_PRIVILEGES` (provision-baseline.ts) carries both now. Each new resource in this package should state the privileges its
 *   reconcile needs, so widening stays a deliberate act rather than a reaction to a 403.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type {
  PoolsPoolidGetReturn,
  PoolsPoolidPutParams,
  PoolsPostParams,
} from './generated/pve.ts';
import { type PveRequirements, type WithTarget, pveHandlers } from './resource.ts';

export interface PoolProps extends WithTarget {
  /** PVE's primary key for a pool. Changing it is a replace, not an update. */
  poolid: string;
  /** Free text shown in the UI — the only mutable field a pool has. */
  comment?: string;
}

export interface PoolAttributes {
  poolid: string;
  comment: string;
  /** Guests currently in the pool, so a plan can say what a delete would refuse to orphan. */
  members: number;
}

export interface ProxmoxPool extends Resource<
  'Proxmox.Pool',
  PoolProps,
  PoolAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxPool = Resource<ProxmoxPool>('Proxmox.Pool');

/** Form bodies this family sends — exported for the drift test in pool.test.ts. */
export const poolCreateForm = (props: PoolProps): PoolsPostParams => ({
  comment: props.comment ?? '',
  poolid: props.poolid,
});

/** PUT body — only `comment`; path carries `poolid`. Matches deprecated `/pools/{poolid}`. */
export const poolUpdateForm = (props: PoolProps): Pick<PoolsPoolidPutParams, 'comment'> => ({
  comment: props.comment ?? '',
});

const handlers = pveHandlers<PoolProps, PoolAttributes>({
  attributes: (live, props) => {
    const row = live as PoolsPoolidGetReturn;
    return {
      comment: typeof row.comment === 'string' ? row.comment : '',
      members: Array.isArray(row.members) ? row.members.length : 0,
      poolid: props.poolid,
    };
  },
  collection: () => 'pools',
  createForm: poolCreateForm,
  matches: (attributes, props) => attributes.comment === (props.comment ?? ''),
  path: (props) => `pools/${props.poolid}`,
  updateForm: poolUpdateForm,
});

export const ProxmoxPoolProvider = () =>
  Provider.effect(ProxmoxPool, Effect.succeed(ProxmoxPool.Provider.of(handlers)));
