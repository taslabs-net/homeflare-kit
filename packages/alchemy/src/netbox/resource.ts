/**
 * One shape for every NetBox object — the same four operations, different distilled call.
 *
 * ⛔ THE ALTERNATIVE IS COPYING THE SAME HANDLERS PER RESOURCE. Prefixes, VLANs, devices, tenants
 *   and interfaces are all create / read / update / delete against `@distilled.cloud/netbox`'s
 *   typed operations. Hand-rolling the fourth copy is where someone drops the read-back or the
 *   constraint guard and the plan lies.
 *
 * ★ SO THE FOUR OPERATIONS LIVE HERE, ONCE — mirroring `../forgejo/resource.ts`'s engine exactly,
 *   plus the constraint-guard wiring every NetBox write already had (guardBody, unchanged).
 *
 * 🔴 WHY THIS REPLACED `client.ts`'s HAND-ROLLED `HttpClient` CALLS. Measured against Tim's
 *   distilled research page 2026-09-23: upstream Alchemy only accepts providers that call
 *   `@distilled.cloud/<vendor>` operations and `catchTag` their typed errors — not a raw
 *   `fetch`/`HttpClient` client over a hand-maintained path table. `@distilled.cloud/netbox`
 *   (published as `@homeflare/distilled-netbox@0.2.0`, aliased in — see
 *   `docs/distilled-interim.md`) covers every operation this family calls.
 *
 * ⚠️ `NotFound` IS FOLDED TO "ABSENT" INSIDE EACH RESOURCE FILE'S OWN `fetchLive`, NOT HERE — the
 *   direct successor to the old, centralized `absentOn404`, and the same split `../forgejo/resource.ts`
 *   uses. `Effect.catchTag`'s tag-literal inference needs a concrete error union to resolve
 *   `"NotFound"` against; a spec's `E` is only concrete at each resource file's own call site. A
 *   NetBox *list* call (what `locateOne` below wraps) never 404s — narrowing happens by an empty
 *   `results` page, not a status code — so nothing here folds a status at all.
 *
 * ★ ADOPT IS THE DEFAULT POSTURE, NOT A FLAG. `reconcile` LOCATES before it writes: an object the
 *   estate already has is bound, not duplicated. NetBox is a record that predates this code by
 *   years; a provider that created a second `10.20.10.0/24` on first deploy would be worse than
 *   no provider.
 *
 * ★ `defaultRemovalPolicy: 'retain'` ON EVERY FAMILY — declared per resource file (prefix.ts),
 *   same as before this migration.
 */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import { CredentialsFromEnv } from '@distilled.cloud/netbox/Credentials';
import type { NetboxOpContext } from '@distilled.cloud/netbox/Protocol';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { guardBody } from './constraint-guard.ts';
import type { EndpointKey, NetboxBody } from './constraints.ts';

/**
 * ★ WHAT EVERY HANDLER NEEDS FROM THE CALLER'S RUNTIME, after Credentials are provided below.
 *   `Netbox.NetboxOpContext` is `Credentials | HttpClient.HttpClient`; `netboxHandlers` closes
 *   over `CredentialsFromEnv` itself (`NETBOX_URL` / `NETBOX_TOKEN`, the names client.ts already
 *   read — see the SDK's own credentials.ts note), so a consuming stack only has to provide
 *   `HttpClient.HttpClient`, exactly as it did before this migration.
 */
export type NetboxRequirements = HttpClient.HttpClient;

/**
 * ⚠️ NOT `limit=1`, AND NOT `limit=2` EITHER. One row is all a caller wants, but the page has to
 *   be wide enough for an `identifies` narrowing to see every candidate a server-side filter
 *   matched — a prefix that exists in several VRFs comes back several times, and a page of two
 *   would hide the third.
 * ★ TWENTY, AND THE NUMBER IS AN ASSERTION: a natural key matching more than twenty rows is not
 *   a natural key. `count` is checked against it, so the failure is "your filter is too broad"
 *   rather than a silent truncation. Unchanged from client.ts's original value.
 */
export const LOCATE_PAGE = 20;

/**
 * The single row a filtered list returns, or `undefined`.
 *
 * ⛔ MORE THAN ONE MATCH IS A DEFECT, NOT A REASON TO TAKE THE FIRST. A `locate` filter that is
 *   not unique would let adopt bind to whichever row NetBox happened to order first, and the next
 *   plan would bind to the other one and report drift that is not there.
 */
export const soleMatch = <T>(rows: readonly T[], describe: string): T | undefined => {
  if (rows.length > 1) {
    throw new Error(
      `${describe} matched ${String(rows.length)} NetBox objects. An object's identity must be ` +
        'unique; narrow it (the VRF, the site, the tenant) rather than taking the first row.',
    );
  }
  return rows[0];
};

/**
 * List, then narrow to at most one candidate — the same "which of these rows IS this object"
 * problem a server-side filter cannot always answer (see prefix.ts's own note on `vrf_id`). Any
 * NetBox resource whose locate is "filter server-side, then disambiguate in this process" reaches
 * this once rather than reimplementing the page-width assertion and the ambiguity defect per
 * resource — the direct successor to client.ts's `fetchLive` helper, generalized over the SDK's
 * own paginated-list shape instead of a hand-decoded `NetboxList<NetboxRow>`.
 */
export const locateOne = <Row, E, R>(
  list: Effect.Effect<{ readonly count: number; readonly results: readonly Row[] }, E, R>,
  describe: string,
  identifies?: (row: Row) => boolean,
): Effect.Effect<Row | undefined, E, R> =>
  list.pipe(
    Effect.map((page) => {
      if (page.count > LOCATE_PAGE) {
        throw new Error(
          `${describe}: the locate filter matched ${String(page.count)} rows, more than the ` +
            `${String(LOCATE_PAGE)}-row page this reads. That is not a natural key — narrow the ` +
            'filter rather than paging through candidates.',
        );
      }
      const rows = identifies === undefined ? page.results : page.results.filter(identifies);
      return soleMatch(rows, describe);
    }),
  );

/**
 * One NetBox object's distilled calls. `Live` is whatever the SDK decodes (a `Prefix`, a `VLAN`,
 * …) — no more untyped `NetboxRow`. `E` is left to each resource file to declare (the union of the
 * distilled operations it actually calls), so a call site's precise per-operation error union
 * flows straight through instead of being widened by hand here.
 */
export type NetboxSpec<Props extends object, Live, Attributes, E> = {
  /** Already folds any real "absent" outcome (an empty list, or a `catchTag('NotFound', ...)`). */
  readonly fetchLive: (props: Props) => Effect.Effect<Live | undefined, E, NetboxOpContext>;
  readonly attributes: (live: Live, props: Props) => Attributes | undefined;
  readonly matches: (attributes: Attributes, props: Props) => boolean;
  readonly createBody: (props: Props) => NetboxBody;
  readonly create: (props: Props, body: NetboxBody) => Effect.Effect<unknown, E, NetboxOpContext>;
  /** Absent for a create-only family — reconcile then never attempts a write against an adopted row. */
  readonly update?: {
    /** ⚠️ PARTIAL BY DESIGN: NetBox updates are PATCH, so presence is not checked on this body. */
    readonly body: (props: Props) => NetboxBody;
    readonly call: (
      props: Props,
      live: Live,
      body: NetboxBody,
    ) => Effect.Effect<unknown, E, NetboxOpContext>;
  };
  readonly destroy: (props: Props, live: Live) => Effect.Effect<unknown, E, NetboxOpContext>;
  /** The generated constraint table to check each body against, by endpoint key. */
  readonly endpoint: { readonly create: EndpointKey; readonly update?: EndpointKey };
  /** For the message `soleMatch` raises and for read-back failures. */
  readonly describe: (props: Props) => string;
};

export const netboxOperations = <Props extends object, Live, Attributes, E>(
  spec: NetboxSpec<Props, Live, Attributes, E>,
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

    reconcile: (news: Props) =>
      Effect.gen(function* () {
        const before = yield* spec.fetchLive(news);
        if (before === undefined) {
          const body = spec.createBody(news);
          // ⛔ GUARD BEFORE THE REQUEST, WITH PRESENCE ON. This is the only place a missing
          //   required property can still be caught locally.
          yield* guardBody(spec.endpoint.create, body, true);
          yield* spec.create(news, body);
        } else if (spec.update !== undefined) {
          const mapped = spec.attributes(before, news);
          // ⚠️ ADOPTION IS THE `mapped === undefined` CASE TOO: a row this spec cannot map is not
          //   a row to PATCH blindly.
          if (mapped !== undefined && !spec.matches(mapped, news)) {
            const body = spec.update.body(news);
            yield* guardBody(spec.endpoint.update, body, false);
            if (Object.keys(body).length > 0) {
              yield* spec.update.call(news, before, body);
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
        const live = yield* spec.fetchLive(olds);
        if (live === undefined) return;
        yield* spec.destroy(olds, live);
      }),
  };
};

/**
 * The five provider handlers for a spec'd NetBox object, wired once.
 *
 * ★ CREDENTIALS ARE PROVIDED HERE, ONCE, NOT BY EVERY CALLER. `CredentialsFromEnv` resolves
 *   `NETBOX_URL` / `NETBOX_TOKEN` on the calling fiber per request, so this closure keeps that
 *   laziness — nothing is captured at module load. ⛔ THE TOKEN IS NEVER A PROP: Alchemy persists
 *   attributes unencrypted, so nothing stored in a stack file may be a credential.
 *
 * ⛔ IT STOPS AT THE HANDLERS AND DOES NOT RETURN THE LAYER — same reasoning as `forgejoHandlers`.
 *
 * ⚠️ `list` answers empty. NetBox index endpoints return the whole estate — tens of thousands of
 *   rows on a real instance — so adoption stays explicit rather than sweeping.
 */
export const netboxHandlers = <Props extends object, Live, Attributes extends object, E>(
  spec: NetboxSpec<Props, Live, Attributes, E>,
) => {
  const ops = netboxOperations(spec);
  const withCredentials = <A>(effect: Effect.Effect<A, E, NetboxOpContext>) =>
    Effect.provide(effect, CredentialsFromEnv);
  return {
    list: () => Effect.succeed([]),
    read: ({ olds }: { olds: Props }) => withCredentials(ops.read(olds)),
    diff: ({ news, output }: { news: Input<Props>; output: Attributes | undefined }) =>
      withCredentials(ops.diff(news, output)),
    reconcile: ({ news }: { news: Props }) => withCredentials(ops.reconcile(news)),
    delete: ({ olds }: { olds: Props }) => withCredentials(ops.destroy(olds)),
  };
};
