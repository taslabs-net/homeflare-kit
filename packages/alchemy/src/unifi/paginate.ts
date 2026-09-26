/**
 * B0b / T9: a CONSUMER-SIDE sequential offset-pager for the SDK's list operations. None of them
 * paginate on their own — `getNetworksOverviewPage`, `getFirewallZones`, `getAclRules`, … all take
 * `{ ..., offset?, limit? }` and answer `{ count, data, limit, offset, totalCount }` (the shape
 * `protocol.ts`'s own header names); there is no `smithy.api#paginated` trait in the pinned spec
 * to generate a helper from.
 *
 * ⛔ NO SDK OR `@distilled.cloud/core` CHANGE (M1 — upstream's own convention: pagination stays
 *   out of the 59 packages walked down for `distilled-doctrine`). This is a plain function over
 *   whatever `Effect.Effect<OffsetPage<T>, E, R>` a resource file's own `fetchPage` already is.
 * ⛔ STOPS ON `totalCount`, NEVER ON `data.length < limit` (T9's own wording). A page can come back
 *   short of the requested `limit` for reasons unrelated to "this was the last page" (a vendor-side
 *   per-call cap, a narrow filter) — `totalCount` is the one number the response commits to, so it
 *   is the only thing this loop trusts to stop early. An empty page (`data.length === 0`) is the
 *   other legitimate stop, and the only one checked before `totalCount` is read.
 * ⚠️ NOT SEQUENCED AGAINST A LIVE CONSOLE THAT MUTATES BETWEEN CALLS. `totalCount` is whatever the
 *   MOST RECENT page reported; a page walk racing a live edit could see a row twice, miss one, or
 *   just see a moving target. `homeflare-network`'s own import already treats one family's fetch
 *   as one sequenced run for this reason (T27's neighboring trap) — nothing here can fix a
 *   concurrent mutation, only walk whatever snapshot each call happens to see.
 */
import * as Effect from 'effect/Effect';

/** The one response shape every UniFi Network list operation already has (`protocol.ts`). */
export interface OffsetPage<T> {
  readonly data: readonly T[];
  readonly totalCount: number;
}

/** The one request shape every UniFi Network list operation already accepts, plus its own fields. */
export type OffsetPageRequest = { readonly offset?: number; readonly limit?: number };

/**
 * Walks every page of `fetchPage`, starting at `request.offset ?? 0`, and returns every row in
 * order. `request.limit`, if given, is kept as the page size for every call; the vendor's own
 * default applies otherwise — this loop never invents one (T18: "pass ops only their own fields").
 */
export const pageAll = <Req extends OffsetPageRequest, T, E, R>(
  fetchPage: (request: Req) => Effect.Effect<OffsetPage<T>, E, R>,
  request: Req,
): Effect.Effect<T[], E, R> =>
  Effect.gen(function* () {
    const rows: T[] = [];
    let offset = request.offset ?? 0;
    while (true) {
      // ⚠️ THE CAST IS SOUND, NOT A SHORTCUT: `Req` is a generic parameter, so TS cannot see that
      //   spreading a value already typed `Req` and overriding one of `OffsetPageRequest`'s own
      //   fields reconstructs a `Req` — but every field except `offset` is untouched from the
      //   caller's own `request`, so it does.
      const page = yield* fetchPage({ ...request, offset } as Req);
      rows.push(...page.data);
      if (page.data.length === 0) break;
      offset += page.data.length;
      if (offset >= page.totalCount) break;
    }
    return rows;
  });
