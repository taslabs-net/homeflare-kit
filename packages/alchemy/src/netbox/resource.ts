/**
 * One shape for every NetBox object — the same four operations, different path and JSON body.
 *
 * ⛔ THE ALTERNATIVE IS COPYING THE SAME HANDLERS PER RESOURCE. Prefixes, VLANs, devices, tenants
 *   and interfaces are all create / read / update / delete over `/api` with JSON bodies and a
 *   numeric primary key. Hand-rolling the fourth copy is where someone drops the read-back or the
 *   constraint guard and the plan lies.
 *
 * ★ ADOPT IS THE DEFAULT POSTURE, NOT A FLAG. `reconcile` LOCATES before it writes: an object the
 *   estate already has is bound, not duplicated. NetBox is a record that predates this code by
 *   years; a provider that created a second `10.20.10.0/24` on first deploy would be worse than
 *   no provider.
 *
 * ★ `defaultRemovalPolicy: 'retain'` ON EVERY FAMILY. NetBox holds the estate's record of what
 *   the network was DECIDED to be, and deleting a row deletes history — child prefixes reparent,
 *   IP assignments detach, and the change log is the only trace left. `retain` means the engine
 *   skips `delete` when a resource is orphaned unless the caller opts into
 *   `.pipe(RemovalPolicy.destroy())`. The `delete` handler is FULLY IMPLEMENTED anyway: a stub
 *   that silently does nothing lies to whoever reads the plan.
 */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { NetboxError, type NetboxList, type NetboxRow, netbox, soleMatch } from './client.ts';
import { guardBody } from './constraint-guard.ts';
import type { EndpointKey, NetboxBody } from './constraints.ts';

/**
 * ★ WHAT EVERY OPERATION HERE NEEDS FROM THE RUNTIME, AND NOTHING MORE. The token comes from
 *   `NETBOX_TOKEN` in the environment, so there is no process to spawn and no `bao` to shell out
 *   to. Declaring a service you never use is not harmless — it makes a stack provide a layer for
 *   nothing, and it hides the one service you DO need.
 */
export type NetboxRequirements = HttpClient.HttpClient;

export interface NetboxSpec<Props extends object, Attributes> {
  /** `ipam/prefixes` — where a new one is POSTed and where `locate` filters. */
  readonly collection: string;
  /**
   * The query that narrows the candidates, as `URLSearchParams` pairs.
   *
   * ⛔ ONLY FILTERS THE VENDOR DOCUMENT DECLARES, AND ONLY IN THE FORM IT DECLARES THEM. A
   *   filter NetBox rejects answers 400, which `absentOn404` correctly does NOT fold to "absent" —
   *   so a guessed filter shape is a hard failure on every plan, not a soft one.
   * ★ IT DOES NOT HAVE TO BE UNIQUE. `identifies` finishes the job in this process, where the
   *   rule is readable and testable offline.
   */
  readonly locate: (props: Props) => readonly (readonly [string, string])[];
  /**
   * Which of the returned rows IS this object.
   *
   * 🔴 THIS EXISTS BECAUSE THE OBVIOUS ALTERNATIVE WAS A GUESS. `Netbox.Prefix` first narrowed
   *   server-side with `vrf_id=null`, the sentinel NetBox uses elsewhere for "no foreign key".
   *   ⛔ MEASURED IN THE VENDOR'S OWN SOURCE at v4.7.0: `PrefixFilterSet.vrf_id` is a plain
   *   `django_filters.ModelMultipleChoiceFilter` with NO `null_value`, so `'null'` is validated
   *   against the VRF queryset, fails, and NetBox answers 400 under strict filtering. The
   *   sentinel is real (`FILTERS_NULL_CHOICE_VALUE = 'null'`) but it is opt-in per filter, and
   *   this one did not opt in.
   * ★ SO THE DISCRIMINATOR MOVED INTO THIS PROCESS. It costs one page of candidates and buys a
   *   rule that can be read, tested without a server, and cannot be wrong about a vendor's
   *   filter semantics. Omit it when `locate` really is unique on its own.
   */
  readonly identifies?: (live: NetboxRow, props: Props) => boolean;
  readonly attributes: (live: NetboxRow, props: Props) => Attributes | undefined;
  readonly createBody: (props: Props) => NetboxBody;
  /** ⚠️ PARTIAL BY DESIGN: NetBox updates are PATCH, so presence is not checked on this body. */
  readonly updateBody?: (props: Props) => NetboxBody;
  readonly matches: (attributes: Attributes, props: Props) => boolean;
  /** The generated constraint table to check each body against, by endpoint key. */
  readonly endpoint: { readonly create: EndpointKey; readonly update?: EndpointKey };
  /** For the message `soleMatch` raises and for read-back failures. */
  readonly describe: (props: Props) => string;
}

/** ⚠️ Only 404 folds to "absent". A 403 or a 502 is a real failure — folding it would plan a create over an existing object. */
const absentOn404 = <A>(io: Effect.Effect<A, NetboxError, NetboxRequirements>) =>
  io.pipe(
    Effect.catchIf(
      (cause): cause is NetboxError => cause instanceof NetboxError && cause.status === 404,
      () => Effect.succeed(undefined as A),
    ),
  );

/**
 * ⚠️ NOT `limit=1`, AND NOT `limit=2` EITHER. One row is all a caller wants, but the page has to
 *   be wide enough for `identifies` to see every candidate `locate` matched — a prefix that
 *   exists in several VRFs comes back several times, and a page of two would hide the third.
 * ★ TWENTY, AND THE NUMBER IS AN ASSERTION: a natural key matching more than twenty rows is not
 *   a natural key. `count` is checked against it, so the failure is "your filter is too broad"
 *   rather than a silent truncation.
 */
const LOCATE_PAGE = 20;

const query = (pairs: readonly (readonly [string, string])[]): string =>
  new URLSearchParams([
    ...pairs.map(([k, v]) => [k, v] as [string, string]),
    ['limit', String(LOCATE_PAGE)],
  ]).toString();

export const netboxOperations = <Props extends object, Attributes>(
  spec: NetboxSpec<Props, Attributes>,
) => {
  const fetchLive = (props: Props) =>
    absentOn404(
      netbox<NetboxList<NetboxRow>>('GET', `${spec.collection}/?${query(spec.locate(props))}`),
    ).pipe(
      Effect.map((list) => {
        if (list !== undefined && list.count > LOCATE_PAGE) {
          throw new Error(
            `${spec.describe(props)}: the locate filter matched ${String(list.count)} rows, more ` +
              `than the ${String(LOCATE_PAGE)}-row page this reads. That is not a natural key — ` +
              'narrow the filter rather than paging through candidates.',
          );
        }
        const rows = list?.results ?? [];
        const narrow = spec.identifies;
        return soleMatch(
          narrow === undefined ? rows : rows.filter((row) => narrow(row, props)),
          spec.describe(props),
        );
      }),
    );

  /** ⛔ The numeric `id` is the wire path. NetBox has no update-by-natural-key. */
  const objectPath = (live: NetboxRow): string => `${spec.collection}/${String(live['id'])}`;

  const read = (props: Props) =>
    fetchLive(props).pipe(
      Effect.map((live) => (live === undefined ? undefined : spec.attributes(live, props))),
    );

  return {
    read,

    diff: (news: Input<Props>, output: Attributes | undefined) =>
      Effect.gen(function* () {
        if (output === undefined || !isResolved(news)) return undefined;
        const live = yield* read(news);
        if (live === undefined) return { action: 'update' } as const;
        if (spec.matches(live, news)) return { action: 'noop' } as const;
        return spec.updateBody === undefined
          ? ({ action: 'replace' } as const)
          : ({ action: 'update' } as const);
      }),

    reconcile: (news: Props) =>
      Effect.gen(function* () {
        const before = yield* fetchLive(news);
        if (before === undefined) {
          const body = spec.createBody(news);
          // ⛔ GUARD BEFORE THE REQUEST, WITH PRESENCE ON. This is the only place a missing
          //   required property can still be caught locally.
          yield* guardBody(spec.endpoint.create, body, true);
          yield* netbox('POST', `${spec.collection}/`, body);
        } else if (spec.updateBody !== undefined) {
          const mapped = spec.attributes(before, news);
          // ⚠️ ADOPTION IS THE `mapped === undefined` CASE TOO: a row this spec cannot map is not
          //   a row to PATCH blindly.
          if (mapped !== undefined && !spec.matches(mapped, news)) {
            const body = spec.updateBody(news);
            yield* guardBody(spec.endpoint.update, body, false);
            if (Object.keys(body).length > 0) {
              yield* netbox('PATCH', `${objectPath(before)}/`, body);
            }
          }
        }
        const after = yield* read(news);
        if (after === undefined) {
          return yield* Effect.die(
            new Error(
              `${spec.describe(news)}: the write returned no error but the object is still ` +
                'absent. NetBox returns the object it wrote — read back rather than trusting the ' +
                'status code.',
            ),
          );
        }
        return after;
      }),

    destroy: (olds: Props) =>
      Effect.gen(function* () {
        const live = yield* fetchLive(olds);
        if (live === undefined) return;
        yield* netbox('DELETE', `${objectPath(live)}/`);
      }),
  };
};

/**
 * The five provider handlers for a spec'd NetBox object, wired once.
 *
 * ⚠️ `list` answers empty. NetBox index endpoints return the whole estate — tens of thousands of
 *   rows on a real instance — so adoption stays explicit rather than sweeping.
 */
export const netboxHandlers = <Props extends object, Attributes extends object>(
  spec: NetboxSpec<Props, Attributes>,
) => {
  const ops = netboxOperations(spec);
  return {
    list: () => Effect.succeed([]),
    read: ({ olds }: { olds: Props }) => ops.read(olds),
    diff: ({ news, output }: { news: Input<Props>; output: Attributes | undefined }) =>
      ops.diff(news, output),
    reconcile: ({ news }: { news: Props }) => ops.reconcile(news),
    delete: ({ olds }: { olds: Props }) => ops.destroy(olds),
  };
};
