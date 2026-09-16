/**
 * One shape for every Forgejo object — the same four operations, different path and JSON body.
 *
 * ⛔ THE ALTERNATIVE IS COPYING THE SAME HANDLERS PER RESOURCE. Repositories, org labels, teams,
 *   runners, branch protection and package settings are all create / read / update / delete over
 *   `/api/v1` with JSON bodies. Hand-rolling the fourth copy is where someone drops the read-back
 *   or the isResolved guard and the plan lies.
 *
 * ★ SO THE FOUR OPERATIONS LIVE HERE, ONCE. A new Forgejo object should be a spec plus ~forty
 *   lines, not a hundred and thirty.
 *
 * ⚠️ GITEA ANSWERS WITH THE OBJECT DIRECTLY — NOT `{"data": ...}`. See client.ts. reconcile still
 *   READS BACK after every write rather than trusting the status code alone.
 *
 * ★ WHY `Forgejo.Repository` DECLARES `defaultRemovalPolicy: 'retain'`, WRITTEN ONCE HERE.
 *   Alchemy's own `GitHub.Repository` defaults to retain "because their contents are
 *   irreplaceable". A git repository is the most irreplaceable object on this estate. `retain`
 *   means the engine skips `provider.delete` when a resource is orphaned unless the caller opted
 *   into `.pipe(RemovalPolicy.destroy())`. The `delete` handler is FULLY IMPLEMENTED anyway — a
 *   stub that silently does nothing lies to whoever reads the plan.
 */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { ForgejoError, forgejo } from './client.ts';

/**
 * ★ WHAT EVERY OPERATION HERE NEEDS FROM THE RUNTIME — and it is NOT what the first draft said.
 *
 *   These resources declared `ChildProcessSpawner`, copied from house/proxmox, where it is there
 *   because a PVE credential is minted by shelling out to `bao`. Nothing in this package shells
 *   out: the token comes from `FORGEJO_TOKEN` in the environment. Declaring a service you never
 *   use is not harmless — it makes a stack provide a layer for nothing, and it hides the one
 *   service you DO need.
 *
 *   What is actually required is `HttpClient`, for the reason in client.ts: Alchemy's own
 *   providers call through Effect's client rather than the global `fetch`.
 */
export type ForgejoRequirements = HttpClient.HttpClient;

export type ForgejoSpec<Props extends object, Attributes> = {
  /** `repos/HomeFlare/homeflare`, `orgs/homeflare/labels/40` — one object. */
  readonly path: (props: Props) => string;
  /** `orgs/HomeFlare/repos`, `orgs/homeflare/labels` — where a new one is POSTed. */
  readonly collection: (props: Props) => string;
  readonly attributes: (live: Record<string, unknown>, props: Props) => Attributes | undefined;
  /** JSON body on create. ⚠️ Gitea takes JSON, not form encoding. */
  readonly createForm: (props: Props) => Record<string, unknown>;
  readonly updateForm?: (props: Props) => Record<string, unknown>;
  readonly matches: (attributes: Attributes, props: Props) => boolean;
  /**
   * When the stable key is not enough for the wire path — org labels are addressed by numeric id.
   * `locate` lists or searches; `wirePath` builds update/delete paths from the live row.
   */
  readonly locate?: (
    props: Props,
  ) => Effect.Effect<Record<string, unknown> | undefined, ForgejoError, ForgejoRequirements>;
  readonly wirePath?: (props: Props, live: Record<string, unknown>) => string;
  /**
   * When create is PUT upsert rather than POST — org actions secrets have no POST and no GET-by-name.
   * `before === undefined` means absent; the callback decides whether to write. Existence-only families
   * noop when `before` is set because the API never returns the value for comparison.
   */
  readonly upsert?: (
    props: Props,
    before: Record<string, unknown> | undefined,
  ) => Effect.Effect<void, ForgejoError, ForgejoRequirements>;
};

/** ⚠️ Only 404 folds to "absent". A 403 is a real failure — folding it would plan a create over an existing object. */
const absentOn404 = <A>(io: Effect.Effect<A, ForgejoError, ForgejoRequirements>) =>
  io.pipe(
    Effect.catchIf(
      (cause): cause is ForgejoError => cause instanceof ForgejoError && cause.status === 404,
      () => Effect.succeed(undefined as A),
    ),
  );

export const forgejoOperations = <Props extends object, Attributes>(
  spec: ForgejoSpec<Props, Attributes>,
) => {
  const fetchLive = (props: Props) =>
    absentOn404(
      spec.locate !== undefined
        ? spec.locate(props)
        : forgejo<Record<string, unknown>>('GET', spec.path(props)),
    );

  const objectPath = (props: Props, live: Record<string, unknown>) =>
    spec.wirePath === undefined ? spec.path(props) : spec.wirePath(props, live);

  const read = (props: Props) =>
    fetchLive(props).pipe(
      Effect.map((data) => (data === undefined ? undefined : spec.attributes(data, props))),
    );

  return {
    read,

    diff: (news: Input<Props>, output: Attributes | undefined) =>
      Effect.gen(function* () {
        if (output === undefined || !isResolved(news)) return undefined;
        const live = yield* read(news);
        if (live === undefined) return { action: 'update' } as const;
        if (spec.matches(live, news)) return { action: 'noop' } as const;
        return spec.updateForm === undefined
          ? ({ action: 'replace' } as const)
          : ({ action: 'update' } as const);
      }),

    reconcile: (news: Props) =>
      Effect.gen(function* () {
        const before = yield* fetchLive(news);
        if (spec.upsert !== undefined) {
          yield* spec.upsert(news, before);
        } else if (before === undefined) {
          yield* forgejo('POST', spec.collection(news), spec.createForm(news));
        } else if (spec.updateForm !== undefined) {
          const mapped = spec.attributes(before, news);
          if (mapped === undefined || spec.matches(mapped, news)) {
            /* adoption or already converged — no PATCH */
          } else {
            const form = spec.updateForm(news);
            if (Object.keys(form).length > 0) {
              yield* forgejo('PATCH', objectPath(news, before), form);
            }
          }
        }
        const after = yield* read(news);
        if (after === undefined) {
          return yield* Effect.die(
            new Error(
              `${spec.path(news)}: the write returned no error but the object is still absent. ` +
                'Gitea returns the object directly — read back rather than trusting the status code.',
            ),
          );
        }
        return after;
      }),

    destroy: (olds: Props) =>
      Effect.gen(function* () {
        const live = yield* fetchLive(olds);
        if (live === undefined) return;
        yield* forgejo('DELETE', objectPath(olds, live));
      }),
  };
};

/**
 * The five provider handlers for a spec'd Forgejo object, wired once.
 *
 * ⛔ IT STOPS AT THE HANDLERS AND DOES NOT RETURN THE LAYER — same reasoning as pveHandlers in
 *   house/proxmox: wrapping `Provider.effect` here needs casts against Alchemy's `Props<R>`.
 *
 * ⚠️ `list` answers empty — Forgejo index endpoints return the whole org; adoption stays explicit.
 */
export const forgejoHandlers = <Props extends object, Attributes extends object>(
  spec: ForgejoSpec<Props, Attributes>,
) => {
  const ops = forgejoOperations(spec);
  return {
    list: () => Effect.succeed([]),
    read: ({ olds }: { olds: Props }) => ops.read(olds),
    diff: ({ news, output }: { news: Input<Props>; output: Attributes | undefined }) =>
      ops.diff(news, output),
    reconcile: ({ news }: { news: Props }) => ops.reconcile(news),
    delete: ({ olds }: { olds: Props }) => ops.destroy(olds),
  };
};
