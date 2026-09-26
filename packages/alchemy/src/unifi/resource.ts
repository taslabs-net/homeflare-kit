/**
 * One shape for every UniFi Network read-only object — `Unifi.Network`, `Unifi.FirewallZone`,
 * and whatever import adds next.
 *
 * ★ MIRRORS `../discord/resource.ts` (S7-S10, H1, H5), NOT `../netbox/resource.ts`. Both are
 *   "marker-less API" families (S8): UniFi Network objects carry no tag or metadata field this
 *   stack could stamp as ownership, so a cold read of a match is `Unowned(attrs)` exactly like
 *   `Cloudflare/Snippets/Snippet.ts@v2.0.0-beta.79#read`, the reference implementation S8 and H1
 *   both cite. `adopt(true)`, piped on by each resource's convenience constructor (H5), turns
 *   that into a silent one-time bind instead of an `OwnedBySomeoneElse` refusal.
 *
 * ⛔ THE DIFFERENCE FROM EVERY OTHER FAMILY HERE: THERE IS NO `create`, `update` OR `destroy` IN
 *   THIS SPEC AT ALL. Tim's rule, 2026-09-24 (`policy.ts`): UniFi and OPNsense are read-only. So
 *   `reconcile` below can only ever refuse or report an exact match — it has no write path to
 *   fall into by accident, and no resource file wired through this engine can reach one either.
 *
 * ⚠️ RECONCILE STILL HAS TO SUCCEED ON AN EXACT-MATCH ADOPTION, NOT JUST REFUSE UNCONDITIONALLY.
 *   Measured against `Plan.ts@v2.0.0-beta.79` (`forceUpdateAfterAdoption`, H6): beta.79 forces
 *   ONE reconcile call after every cold adoption, whether or not the diff said noop — so a
 *   resource whose `reconcile` always failed would break the ordinary "adopt an unchanged
 *   object" deploy, not just a real write. The fix, exactly like `discordOperations.reconcile`:
 *   read the live object again, and refuse ONLY when it is missing (would need a create) or
 *   drifted (would need a write to converge). An exact match returns the live attributes and
 *   calls nothing — S10's "zero write calls when there is no drift" holds even under the forced
 *   post-adoption call.
 *
 * ⚠️ `NotFound` IS FOLDED TO "ABSENT" INSIDE EACH RESOURCE FILE'S OWN `fetchLive`, NOT HERE —
 *   same split netbox's `resource.ts` uses and for the same reason: `Effect.catchTag`'s
 *   tag-literal inference needs a concrete error union to resolve `"NotFound"` against, and a
 *   spec's `E` is only concrete at each resource file's own call site. Every OTHER failure (a
 *   real 5xx, a network error, `Forbidden`) is NOT folded anywhere — it fails the plan loudly,
 *   per the task's own rule: only a genuine not-found may mean absent.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import { CredentialsFromEnv } from '@distilled.cloud/unifi-network/Credentials';
import type { UnifiNetworkOpContext } from '@distilled.cloud/unifi-network/Protocol';
import * as Effect from 'effect/Effect';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import { UNIFI_READ_ONLY_POLICY, refuseWrite } from './policy.ts';

/** What every handler needs from the caller's runtime once `CredentialsFromEnv` is baked in. */
export type UnifiRequirements = HttpClient.HttpClient;

/**
 * One UniFi Network object's read. `Live` is whatever the SDK decodes (a `NetworkDetails`, a
 * `FirewallZone`, …); `E` is left to each resource file to declare (its own `fetchLive`'s error
 * union, with `NotFound` already folded away) so the precise per-operation error union flows
 * through instead of being widened by hand here.
 */
export type UnifiSpec<Props extends object, Live, Attributes extends object, E> = {
  /** The vendor type string, e.g. `Unifi.Network` — for the refusal message only. */
  readonly type: string;
  /** Already folds a genuine not-found to `undefined`; nothing else is folded (see header). */
  readonly fetchLive: (props: Props) => Effect.Effect<Live | undefined, E, UnifiNetworkOpContext>;
  readonly attributes: (live: Live, props: Props) => Attributes;
  readonly matches: (attributes: Attributes, props: Props) => boolean;
  /** For the refusal message and read-back failures. */
  readonly describe: (props: Props) => string;
};

export const unifiOperations = <Props extends object, Live, Attributes extends object, E>(
  spec: UnifiSpec<Props, Live, Attributes, E>,
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

    reconcile: (news: Props) =>
      Effect.gen(function* () {
        const live = yield* read(news);
        if (live === undefined) return yield* refuseWrite(spec.type, spec.describe(news), 'create');
        if (!spec.matches(live, news)) {
          return yield* refuseWrite(spec.type, spec.describe(news), 'update');
        }
        // Exact match: the object already is what is declared. Zero write calls (S10), correct
        // whether this is a routine deploy or beta.79's forced post-adoption reconcile (H6).
        return live;
      }),

    destroy: (olds: Props) => refuseWrite(spec.type, spec.describe(olds), 'delete'),
  };
};

/**
 * B0a / T12 DEFENSE IN DEPTH. `policy.ts`'s `UnifiWriteRefused` stops write INTENT at
 * `reconcile`/`destroy` — every path this engine exposes already returns that refusal instead of
 * calling an SDK write op. This guard stops the same thing one layer lower, AT THE WIRE: it wraps
 * whatever `HttpClient` the caller already provides (the stack's `FetchHttpClient.layer` in
 * production, `fakeUnifiLayer` in tests — `openbao/bao-http.ts`'s header names this same
 * "wrap, don't replace" seam) so a future resource file that, by mistake, called an SDK write
 * operation directly — bypassing `unifiOperations` entirely — would still never reach the vendor
 * API. `write-op-reference.test.ts` proves no such call exists today; this is what stops one from
 * ever taking effect if one is ever added.
 *
 * ⚠️ `Effect.die`, NOT A TYPED FAILURE — classified per distilled-doctrine's "classify every
 *   die/orDie". Every generated SDK operation (`networks.getNetworkDetails`, …) declares its OWN
 *   closed error union from the pinned OpenAPI spec, and generated files are never hand-edited to
 *   add a member to it. A typed `Effect.fail` here would be a failure mode absent from every op's
 *   declared type the moment it occurred — a type-system lie. A defect is the sound way to add a
 *   NEW "this must be structurally impossible" failure underneath types this package does not
 *   own, exactly like `openbao`'s `refuse()` helpers' `Effect.die(new Error(...))` for a
 *   configuration move that should never be reachable.
 */
export class UnifiNonGetRequest extends Error {
  constructor(
    readonly method: string,
    readonly url: string,
  ) {
    super(
      `UniFi HttpClient guard: refused ${method} ${url} -- ${UNIFI_READ_ONLY_POLICY}. This is a ` +
        'defect, not a recoverable condition: something under src/unifi tried to send a non-GET ' +
        "request, which policy.ts's per-operation refusal should already have made impossible. " +
        'Fix the kit code that produced this request.',
    );
    this.name = 'UnifiNonGetRequest';
  }
}

const guardGetOnly = (client: HttpClient.HttpClient): HttpClient.HttpClient =>
  client.pipe(
    HttpClient.mapRequestEffect((request) =>
      request.method === 'GET'
        ? Effect.succeed(request)
        : Effect.die(new UnifiNonGetRequest(request.method, request.url)),
    ),
  );

/**
 * A `Layer` that reads whatever `HttpClient` is already in the calling context and replaces it,
 * for everything downstream, with `guardGetOnly`'s wrapped version (`HttpClient.layerMergedContext`
 * — see the guard above). Exported so `get-only-guard.test.ts` can prove the mechanism directly,
 * against a bare `HttpClient` service, without needing `CredentialsFromEnv` or any env var at all.
 */
export const GetOnlyHttpClient = HttpClient.layerMergedContext(
  Effect.map(HttpClient.HttpClient, guardGetOnly),
);

/**
 * The four provider handlers for a spec'd read-only UniFi object, wired once.
 *
 * ⛔ `list` ANSWERS EMPTY. `GET /v1/sites/{siteId}/networks` answers every network on the site;
 *   adoption stays explicit, the same reasoning `Proxmox.User`'s and NetBox's `list` give.
 */
export const unifiHandlers = <Props extends object, Live, Attributes extends object, E>(
  spec: UnifiSpec<Props, Live, Attributes, E>,
) => {
  const ops = unifiOperations(spec);
  const withCredentials = <A, Err>(effect: Effect.Effect<A, Err, UnifiNetworkOpContext>) =>
    effect.pipe(Effect.provide(GetOnlyHttpClient), Effect.provide(CredentialsFromEnv));
  return {
    list: () => Effect.succeed([]),
    read: (args: { olds: Props; output: Attributes | undefined }) =>
      withCredentials(ops.readHandler(args)),
    diff: (args: { news: Input<Props>; output: Attributes | undefined }) =>
      withCredentials(ops.diff(args.news, args.output)),
    reconcile: (args: { news: Props }) => withCredentials(ops.reconcile(args.news)),
    delete: (args: { olds: Props }) => withCredentials(ops.destroy(args.olds)),
  };
};
