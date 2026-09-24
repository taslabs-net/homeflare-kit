/**
 * One shape for every Grafana object this family declares — mirroring `../forgejo/resource.ts`
 * and `../netbox/resource.ts` exactly, minus the credentials wrapping those two bake in.
 *
 * ★ CREDENTIALS ARE NOT PROVIDED HERE. Forgejo and NetBox each manage exactly one instance for
 *   this house, so their engines close over a hardcoded `CredentialsFromEnv`. Grafana does not —
 *   see `credentials.ts`'s note on `grafana.homeflare.dev` vs `teslamate-grafana` — so `Credentials`
 *   stays a context requirement on every handler here, and `providers.ts`'s `grafanaProviders`
 *   supplies it per target with `Layer.provide`, the same composition `litellm/providers.ts` uses.
 *
 * ⚠️ `NotFound` IS FOLDED TO "ABSENT" INSIDE EACH RESOURCE FILE'S OWN `fetchLive`, NOT HERE — the
 *   same split forgejo's and netbox's engines use. `Effect.catchTag`'s tag-literal inference needs
 *   a concrete error union to resolve `"NotFound"` against; a spec's `E` is only concrete at each
 *   resource file's own call site.
 */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import type { GrafanaOpContext } from '@distilled.cloud/grafana/Protocol';
import * as Effect from 'effect/Effect';

/**
 * One Grafana object's distilled calls. `Live` is whatever the SDK decodes (a `DataSource`, …) —
 * no untyped `Record<string, unknown>`. `E` is left to each resource file to declare (the union
 * of the distilled operations it actually calls plus any domain refusal, e.g. an unset secret-ref
 * env var), so a call site's precise error union flows straight through instead of being widened
 * by hand here.
 */
export type GrafanaSpec<Props extends object, Live, Attributes, E> = {
  /** Already folds the SDK's `NotFound` to `undefined` via its own `catchTag` — see the note above. */
  readonly fetchLive: (props: Props) => Effect.Effect<Live | undefined, E, GrafanaOpContext>;
  readonly attributes: (live: Live, props: Props) => Attributes | undefined;
  readonly matches: (attributes: Attributes, props: Props) => boolean;
  readonly create: (props: Props) => Effect.Effect<unknown, E, GrafanaOpContext>;
  readonly update?: (props: Props, live: Live) => Effect.Effect<unknown, E, GrafanaOpContext>;
  readonly destroy: (props: Props, live: Live) => Effect.Effect<unknown, E, GrafanaOpContext>;
};

export const grafanaOperations = <Props extends object, Live, Attributes, E>(
  spec: GrafanaSpec<Props, Live, Attributes, E>,
) => {
  const read = (props: Props) =>
    spec
      .fetchLive(props)
      .pipe(Effect.map((live) => (live === undefined ? undefined : spec.attributes(live, props))));

  return {
    read,

    diff: (news: Input<Props>, output: Attributes | undefined) =>
      Effect.gen(function* () {
        if (output === undefined || !isResolved(news)) return undefined;
        const live = yield* read(news);
        if (live === undefined) return { action: 'update' } as const;
        if (spec.matches(live, news)) return { action: 'noop' } as const;
        return spec.update === undefined
          ? ({ action: 'replace' } as const)
          : ({ action: 'update' } as const);
      }),

    /**
     * ★ OBSERVES BEFORE IT WRITES (S9, S10) — THE WHOLE OF "ADOPT" FOR THIS FAMILY. A `uid` this
     *   Grafana instance already has is bound and, when it already matches the declaration,
     *   left alone; only a genuinely absent `uid` is created. Declaring exactly what is live
     *   changes nothing on `reconcile`, the same posture netbox/resource.ts documents as
     *   "adopt is the default posture, not a flag".
     */
    reconcile: (news: Props) =>
      Effect.gen(function* () {
        const before = yield* spec.fetchLive(news);
        if (before === undefined) {
          yield* spec.create(news);
        } else if (spec.update !== undefined) {
          const mapped = spec.attributes(before, news);
          if (mapped === undefined || spec.matches(mapped, news)) {
            /* adoption or already converged — no write */
          } else {
            yield* spec.update(news, before);
          }
        }
        const after = yield* read(news);
        if (after === undefined) {
          return yield* Effect.die(
            new Error(
              'grafanaOperations: the write returned no error but the object is still absent. ' +
                'Read back rather than trusting the response status.',
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
 * The five provider handlers for a spec'd Grafana object, wired once. `Credentials` and
 * `HttpClient.HttpClient` stay ambient context requirements — see the file header.
 *
 * ⚠️ `list` answers empty — an org's full datasource list is not a page this family sweeps for
 *   adoption; adoption stays explicit, the same reasoning forgejo's and netbox's engines give.
 */
export const grafanaHandlers = <Props extends object, Live, Attributes extends object, E>(
  spec: GrafanaSpec<Props, Live, Attributes, E>,
) => {
  const ops = grafanaOperations(spec);
  return {
    list: () => Effect.succeed([]),
    read: ({ olds }: { olds: Props }) => ops.read(olds),
    diff: ({ news, output }: { news: Input<Props>; output: Attributes | undefined }) =>
      ops.diff(news, output),
    reconcile: ({ news }: { news: Props }) => ops.reconcile(news),
    delete: ({ olds }: { olds: Props }) => ops.destroy(olds),
  };
};
