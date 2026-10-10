/**
 * One shape for every UniFi Network object — `Unifi.Network`, `Unifi.FirewallZone`, and whatever
 * import adds next. ADOPT-ONLY, except the one `update` a spec may opt into (`Unifi.Network`).
 *
 * ★ MIRRORS `../discord/resource.ts` (S7-S10, H1, H5), NOT `../netbox/resource.ts`. Both are
 *   "marker-less API" families (S8): UniFi Network objects carry no tag or metadata field this
 *   stack could stamp as ownership, so a cold read of a match is `Unowned(attrs)` exactly like
 *   `Cloudflare/Snippets/Snippet.ts@v2.0.0-beta.79#read`, the reference implementation S8 and H1
 *   both cite. `adopt(true)`, piped on by each resource's convenience constructor (H5), turns
 *   that into a silent one-time bind instead of an `OwnedBySomeoneElse` refusal.
 *
 * ⛔ THE POSTURE (`policy.ts`, Tim 2026-09-24, lifted for ONE case 2026-10-10): there is no
 *   `create` and no `destroy` in this spec at all, and `update` exists only when a spec carries an
 *   `update` block (`update-reconcile.ts`). `reconcile` is `updateReconcile`: refuse a create,
 *   report an exact match with zero writes, and otherwise either refuse or run the three-way PUT.
 *   A spec without `update` (every family but Network) can only ever refuse or report a match.
 *
 * ⚠️ RECONCILE STILL HAS TO SUCCEED ON AN EXACT-MATCH ADOPTION, NOT JUST REFUSE UNCONDITIONALLY.
 *   Measured against `Plan.ts@v2.0.0-beta.79` (`forceUpdateAfterAdoption`, H6): beta.79 forces
 *   ONE reconcile call after every cold adoption, whether or not the diff said noop — so a
 *   resource whose `reconcile` always failed would break the ordinary "adopt an unchanged
 *   object" deploy, not just a real write. The fix, exactly like `discordOperations.reconcile`:
 *   read the live object again and return it on a match. S10's "zero write calls when there is
 *   no drift" holds even under the forced post-adoption call.
 *
 * ⚠️ `NotFound` IS FOLDED TO "ABSENT" INSIDE EACH RESOURCE FILE'S OWN `fetchLive`, NOT HERE —
 *   same split netbox's `resource.ts` uses and for the same reason: `Effect.catchTag`'s
 *   tag-literal inference needs a concrete error union to resolve `"NotFound"` against, and a
 *   spec's `E` is only concrete at each resource file's own call site. Every OTHER failure (a
 *   real 5xx, a network error, `Forbidden`) is NOT folded anywhere — it fails the plan loudly,
 *   per the task's own rule: only a genuine not-found may mean absent.
 *
 * ★ The wire guard (`wire-guard.ts`) and the three-way reconcile (`update-reconcile.ts`) live in
 *   their own files; `read`/`diff`/`delete` run under `GetOnlyHttpClient`, only `reconcile` gets
 *   the per-row allow entry of a spec that declares `update`.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import { CredentialsFromEnv } from '@distilled.cloud/unifi-network/Credentials';
import type { UnifiNetworkOpContext } from '@distilled.cloud/unifi-network/Protocol';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/http/HttpClient';
import { refuseWrite } from './policy.ts';
import { type ReconcileArgs, type UnifiUpdate, updateReconcile } from './update-reconcile.ts';
import { GetOnlyHttpClient, guardedHttpClient } from './wire-guard.ts';

/** What every handler needs from the caller's runtime once `CredentialsFromEnv` is baked in. */
export type UnifiRequirements = HttpClient.HttpClient;

/**
 * One UniFi Network object's read. `Live` is whatever the SDK decodes (a `NetworkDetails`, a
 * `FirewallZone`, …); `E` is left to each resource file to declare (its own `fetchLive`'s error
 * union, with `NotFound` already folded away) so the precise per-operation error union flows
 * through instead of being widened by hand here. `E2` is the error union of the optional write.
 */
export type UnifiSpec<Props extends object, Live, Attributes extends object, E, E2 = never> = {
  /** The vendor type string, e.g. `Unifi.Network` — for the refusal message only. */
  readonly type: string;
  /** Already folds a genuine not-found to `undefined`; nothing else is folded (see header). */
  readonly fetchLive: (props: Props) => Effect.Effect<Live | undefined, E, UnifiNetworkOpContext>;
  readonly attributes: (live: Live, props: Props) => Attributes;
  readonly matches: (attributes: Attributes, props: Props) => boolean;
  /** For the refusal message and read-back failures. */
  readonly describe: (props: Props) => string;
  /** Present only on a family allowed to write (`Unifi.Network`); see `update-reconcile.ts`. */
  readonly update?: UnifiUpdate<Props, Live, E2>;
};

export const unifiOperations = <Props extends object, Live, Attributes extends object, E, E2>(
  spec: UnifiSpec<Props, Live, Attributes, E, E2>,
) => {
  const read = (props: Props) =>
    spec
      .fetchLive(props)
      .pipe(Effect.map((live) => (live === undefined ? undefined : spec.attributes(live, props))));

  return {
    read,

    readHandler: ({ olds, output }: { olds: Props; output: Attributes | undefined }) =>
      Effect.gen(function* () {
        const attrs = yield* read(olds);
        if (attrs === undefined) return undefined;
        // Warm read (persisted `output` says a prior apply already adopted this exact object):
        // plain attributes. Cold read (fresh store, or state lost): no ownership marker on this
        // vendor exists to tell "ours" from "someone else's" apart, so Unowned until adopt(true).
        return output !== undefined ? attrs : Unowned(attrs);
      }),

    diff: (news: Input<Props>, output: Attributes | undefined) =>
      Effect.gen(function* () {
        if (output === undefined || !isResolved(news)) return undefined;
        const live = yield* read(news);
        if (live === undefined) return { action: 'update' } as const;
        return spec.matches(live, news)
          ? ({ action: 'noop' } as const)
          : ({ action: 'update' } as const);
      }),

    /** Pre-state callers (tests, adopt-only probes) pass just `news`: `olds`/`output` unset. */
    reconcile: (news: Props, rest: Partial<Omit<ReconcileArgs<Props>, 'news'>> = {}) =>
      updateReconcile(spec, {
        news,
        olds: rest.olds,
        output: rest.output,
        note: rest.note ?? (() => Effect.void),
      }),

    destroy: (olds: Props) => refuseWrite(spec.type, spec.describe(olds), 'delete'),
  };
};

/**
 * The four provider handlers for a spec'd UniFi object, wired once.
 *
 * ⛔ `list` ANSWERS EMPTY. `GET /v1/sites/{siteId}/networks` answers every network on the site;
 *   adoption stays explicit, the same reasoning `Proxmox.User`'s and NetBox's `list` give.
 */
export const unifiHandlers = <Props extends object, Live, Attributes extends object, E, E2>(
  spec: UnifiSpec<Props, Live, Attributes, E, E2>,
) => {
  const ops = unifiOperations(spec);
  const withCredentials = <A, Err>(
    effect: Effect.Effect<A, Err, UnifiNetworkOpContext>,
    guard: typeof GetOnlyHttpClient = GetOnlyHttpClient,
  ) => effect.pipe(Effect.provide(guard), Effect.provide(CredentialsFromEnv));
  return {
    list: () => Effect.succeed([]),
    read: (args: { olds: Props; output: Attributes | undefined }) =>
      withCredentials(ops.readHandler(args)),
    diff: (args: { news: Input<Props>; output: Attributes | undefined }) =>
      withCredentials(ops.diff(args.news, args.output)),
    // ⛔ ONLY `reconcile` gets the per-row allow entry, and only when the spec declares `update`.
    reconcile: (args: {
      news: Props;
      olds: Props | undefined;
      output: Attributes | undefined;
      session: { note: (message: string) => Effect.Effect<void, never, never> };
    }) =>
      withCredentials(
        ops.reconcile(args.news, {
          olds: args.olds,
          output: args.output,
          note: (message) => args.session.note(message),
        }),
        guardedHttpClient(spec.update ? [spec.update.allowedWrite(args.news)] : []),
      ),
    delete: (args: { olds: Props }) => withCredentials(ops.destroy(args.olds)),
  };
};
