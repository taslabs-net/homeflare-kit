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
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as pools from '@distilled.cloud/proxmox/pools';
import { ProxmoxParseError } from '@distilled.cloud/proxmox/Errors';
import * as Schema from 'effect/Schema';
import * as Effect from 'effect/Effect';
import type { PoolsPoolidPutParams, PoolsPostParams } from './generated/pve.ts';
import type { PveRequirements, PveSpec, WithTarget } from './resource-spec.ts';
import { runPve } from './distilled-pve.ts';
import { specGuards } from './resource-guard.ts';

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

const spec = {
  attributes: (live, props) => {
    const row = live;
    return {
      comment: typeof row.comment === 'string' ? row.comment : '',
      members: Array.isArray(row.members) ? row.members.length : 0,
      poolid: props.poolid,
    };
  },
  collection: () => 'pools',
  createForm: poolCreateForm,
  /** The vendor rules these forms are checked against at plan time — resource-spec.ts. */
  endpoint: { create: 'pve:POST /pools', update: 'pve:PUT /pools/{poolid}' },
  matches: (attributes, props) => attributes.comment === (props.comment ?? ''),
  path: (props) => `pools/${props.poolid}`,
  updateForm: poolUpdateForm,
} satisfies PveSpec<PoolProps, PoolAttributes>;

const { guardCreate, guardUpdate } = specGuards(spec);

/** Pool absence is PVE's typed 500, not a catch-all; pve-manager 9.2.11. */
export const readPool = (props: PoolProps) =>
  runPve(props.target, 'read', false, pools.getPool({ poolid: props.poolid })).pipe(
    Effect.flatMap((live) =>
      Schema.decodeUnknownEffect(Schema.toType(pools.GetPoolResponse))(live).pipe(
        Effect.mapError(
          () =>
            new ProxmoxParseError({
              body: undefined,
              cause: 'Pool response does not match its vendor schema',
            }),
        ),
        Effect.as(live),
      ),
    ),
    Effect.map((live) => spec.attributes({ ...live }, props)),
    Effect.catchTag('PoolNotFound', () => Effect.succeed(undefined)),
    Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
  );

export const deletePool = (props: PoolProps) =>
  runPve(props.target, 'provision', true, pools.deletePool({ poolid: props.poolid })).pipe(
    Effect.catchTag('PoolNotFound', () => Effect.void),
    Effect.catchTag('NotFound', () => Effect.void),
  );

export const ProxmoxPoolProvider = () =>
  Provider.effect(
    ProxmoxPool,
    Effect.succeed(
      ProxmoxPool.Provider.of({
        /** Pools are adopted explicitly; an index must not silently claim every existing pool. */
        list: () => Effect.succeed([]),
        read: ({ olds }) => readPool(olds),
        diff: Effect.fn(function* ({ news, output }) {
          if (!isResolved(news)) return undefined;
          yield* guardCreate(news, output === undefined);
          yield* guardUpdate(news);
          if (output === undefined) return undefined;
          const live = yield* readPool(news);
          if (live === undefined) {
            yield* guardCreate(news, true);
            return { action: 'update' } as const;
          }
          return { action: spec.matches(live, news) ? 'noop' : 'update' } as const;
        }),
        reconcile: Effect.fn(function* ({ news }) {
          const live = yield* readPool(news);
          yield* guardCreate(news, live === undefined);
          yield* guardUpdate(news);
          if (live === undefined) {
            yield* runPve(news.target, 'provision', true, pools.createPool(poolCreateForm(news)));
          } else if (!spec.matches(live, news)) {
            yield* runPve(
              news.target,
              'provision',
              true,
              pools.putPool({
                ...poolUpdateForm(news),
                poolid: news.poolid,
              }),
            );
          }
          const after = yield* readPool(news);
          if (after === undefined)
            return yield* Effect.fail(
              new Error(
                `pools/${news.poolid}: write returned success but the pool is still absent`,
              ),
            );
          return after;
        }),
        /** A nonempty-pool refusal still propagates; there is no force-delete fallback. */
        delete: ({ olds }) => deletePool(olds),
      }),
    ),
  );
