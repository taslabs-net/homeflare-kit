/**
 * One shape for every Argo CD object this family declares — mirroring `../discord/resource.ts`
 * (Unowned on a cold read) and `../grafana/resource.ts` (credentials stay a context requirement).
 *
 * ★ CREDENTIALS ARE NOT PROVIDED HERE. Distilled's `CredentialsFromEnv` defaults the server to
 *   `https://localhost:8080`, which is the wrong origin for a Talos cluster. `argocdProviders`
 *   supplies a per-instance layer via `Layer.provide`, the same composition `grafanaProviders`
 *   uses.
 *
 * ★ UNLIKE FORGEJO/GRAFANA, THIS FOLLOWS UPSTREAM'S MARKER-LESS READ (S7, S8, H1). Argo CD
 *   objects carry no ownership stamp this stack can prove — so a live match with no persisted
 *   `output` is `Unowned(attrs)`. `adopt(true)` on each convenience constructor (H5) turns that
 *   into a one-time takeover instead of `OwnedBySomeoneElse`.
 *
 * ⚠️ `NotFound` IS FOLDED TO "ABSENT" INSIDE EACH RESOURCE FILE'S OWN `fetchLive`, NOT HERE —
 *   `Effect.catchTag`'s tag-literal inference needs a concrete error union, and Distilled Argo
 *   operations share `ArgocdOpError`, which includes core `NotFound` via `HTTP_STATUS_MAP`.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import type { ArgocdOpContext } from '@distilled.cloud/argocd/Protocol';
import * as Effect from 'effect/Effect';

export type ArgoCDSpec<Props extends object, Live, Attributes extends object, E> = {
  readonly fetchLive: (props: Props) => Effect.Effect<Live | undefined, E, ArgocdOpContext>;
  readonly attributes: (live: Live, props: Props) => Attributes;
  readonly matches: (attributes: Attributes, props: Props) => boolean;
  readonly create: (props: Props) => Effect.Effect<unknown, E, ArgocdOpContext>;
  readonly update?: (props: Props, live: Live) => Effect.Effect<unknown, E, ArgocdOpContext>;
  readonly destroy: (props: Props, live: Live) => Effect.Effect<unknown, E, ArgocdOpContext>;
  readonly describe: (props: Props) => string;
};

export const argocdOperations = <Props extends object, Live, Attributes extends object, E>(
  spec: ArgoCDSpec<Props, Live, Attributes, E>,
) => {
  const readLive = (props: Props) =>
    spec
      .fetchLive(props)
      .pipe(Effect.map((live) => (live === undefined ? undefined : spec.attributes(live, props))));

  return {
    read: ({ olds, output }: { olds: Props; output: Attributes | undefined }) =>
      Effect.gen(function* () {
        const live = yield* spec.fetchLive(olds);
        if (live === undefined) return undefined;
        const attrs = spec.attributes(live, olds);
        if (output !== undefined) return attrs;
        return Unowned(attrs);
      }),

    diff: (news: Input<Props>, output: Attributes | undefined) =>
      Effect.gen(function* () {
        if (output === undefined || !isResolved(news)) return undefined;
        const live = yield* readLive(news);
        if (live === undefined) return { action: 'update' } as const;
        if (spec.matches(live, news)) return { action: 'noop' } as const;
        return spec.update === undefined
          ? ({ action: 'replace' } as const)
          : ({ action: 'update' } as const);
      }),

    /**
     * ★ OBSERVES BEFORE IT WRITES (S9, S10). A name this Argo CD instance already has is bound
     *   and, when it already matches the declaration, left alone. Declaring exactly what is live
     *   changes nothing on `reconcile`.
     */
    reconcile: (news: Props) =>
      Effect.gen(function* () {
        const before = yield* spec.fetchLive(news);
        if (before === undefined) {
          yield* spec.create(news);
        } else if (spec.update !== undefined) {
          const mapped = spec.attributes(before, news);
          if (spec.matches(mapped, news)) {
            /* adoption or already converged — no write */
          } else {
            yield* spec.update(news, before);
          }
        }
        const after = yield* readLive(news);
        if (after === undefined) {
          return yield* Effect.die(
            new Error(
              `${spec.describe(news)}: the write returned no error but the object is still ` +
                'absent. Read back rather than trusting the response status.',
            ),
          );
        }
        return after;
      }),

    destroy: (olds: Props) =>
      Effect.gen(function* () {
        const live = yield* spec.fetchLive(olds);
        if (live === undefined) return;
        yield* spec.destroy(olds, live);
      }),
  };
};

/**
 * The five provider handlers for a spec'd Argo CD object. `Credentials` and
 * `HttpClient.HttpClient` stay ambient — see the file header.
 *
 * ⚠️ `list` answers empty. An Argo CD instance's full application/project/repo list is not a
 *   page this family sweeps for adoption; adoption stays explicit.
 */
export const argocdHandlers = <Props extends object, Live, Attributes extends object, E>(
  spec: ArgoCDSpec<Props, Live, Attributes, E>,
) => {
  const ops = argocdOperations(spec);
  return {
    list: () => Effect.succeed([]),
    read: ({ olds, output }: { olds: Props; output: Attributes | undefined }) =>
      ops.read({ olds, output }),
    diff: ({ news, output }: { news: Input<Props>; output: Attributes | undefined }) =>
      ops.diff(news, output),
    reconcile: ({ news }: { news: Props }) => ops.reconcile(news),
    delete: ({ olds }: { olds: Props }) => ops.destroy(olds),
  };
};
