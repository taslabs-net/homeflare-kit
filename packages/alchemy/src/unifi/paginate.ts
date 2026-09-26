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
 *   concurrent mutation, only DETECT the common ways one shows up (below) instead of returning a
 *   silently wrong row set.
 *
 * ⚠️ RED TEAM (2026-09-26, IMPORTANT-3): the first version of this file trusted the vendor's
 *   paged response completely — a lying or drifting `totalCount`, an ignored `offset`, or a row
 *   added/removed mid-walk all produced a WRONG row set with no signal at all (silent truncation,
 *   an infinite loop, or a subtly incomplete list an importer would commit as if it were correct).
 *   Every list op's response already carries `offset` alongside `totalCount` (`networks.ts`'s
 *   `NetworkOverviewPage`, and `protocol.ts`'s header for every OTHER list op too); the three
 *   checks below are consistency proofs built entirely from fields the vendor already sends, plus
 *   a hard ceiling as a backstop against a walk that can never converge. These are typed failures,
 *   not `Effect.die`: an inconsistent paged response is a VENDOR-DATA condition a caller may
 *   legitimately want to retry or report on (distilled-doctrine: a defect is for "structurally
 *   impossible" code paths, not for data the wire actually sent).
 */
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';

/** The one response shape every UniFi Network list operation already has (`protocol.ts`). */
export interface OffsetPage<T> {
  readonly data: readonly T[];
  readonly offset: number;
  readonly totalCount: number;
}

/** The one request shape every UniFi Network list operation already accepts, plus its own fields. */
export type OffsetPageRequest = { readonly offset?: number; readonly limit?: number };

/** Well past any family's real row count, even at a one-row page size (`docs/unifi.md`: a real
 *  console's largest family is in the hundreds, not thousands) — a walk that reaches this many
 *  pages is not looking at a real UniFi site, it is looking at a response that never lets `offset`
 *  converge on `totalCount`. */
const MAX_PAGES = 1000;

export class UnifiPaginationInconsistent extends Data.TaggedError('UnifiPaginationInconsistent')<{
  readonly reason:
    | 'offset-mismatch'
    | 'total-count-changed'
    | 'row-count-mismatch'
    | 'page-ceiling';
  readonly detail: string;
}> {
  override get message(): string {
    return (
      `UniFi pager: ${this.reason} -- ${this.detail}. The paged response contradicted itself (or ` +
      'the walk ran implausibly long); the rows collected so far cannot be trusted and are not returned.'
    );
  }
}

/**
 * Walks every page of `fetchPage`, starting at `request.offset ?? 0`, and returns every row in
 * order. `request.limit`, if given, is kept as the page size for every call; the vendor's own
 * default applies otherwise — this loop never invents one (T18: "pass ops only their own fields").
 *
 * Three self-consistency checks run against fields the vendor already sends with every page —
 * detection, not a fix, for the "live console mutates mid-walk" case the header above accepts as
 * unfixable from the client alone: a row added AND removed in the same window can still net out to
 * a `totalCount` and final row count that agree by coincidence. What this closes is the SILENT
 * version of every case actually observed in review: an ignored `offset`, a `totalCount` that
 * drifts between calls, and an undercounted `totalCount` that truncates the walk early.
 */
export const pageAll = <Req extends OffsetPageRequest, T, E, R>(
  fetchPage: (request: Req) => Effect.Effect<OffsetPage<T>, E, R>,
  request: Req,
): Effect.Effect<T[], E | UnifiPaginationInconsistent, R> =>
  Effect.gen(function* () {
    const rows: T[] = [];
    const startOffset = request.offset ?? 0;
    let offset = startOffset;
    let totalCount: number | undefined;
    for (let pageCount = 1; ; pageCount++) {
      if (pageCount > MAX_PAGES) {
        return yield* new UnifiPaginationInconsistent({
          reason: 'page-ceiling',
          detail: `stopped after ${MAX_PAGES} pages at offset ${offset} without reaching totalCount`,
        });
      }
      // ⚠️ THE CAST IS SOUND, NOT A SHORTCUT: `Req` is a generic parameter, so TS cannot see that
      //   spreading a value already typed `Req` and overriding one of `OffsetPageRequest`'s own
      //   fields reconstructs a `Req` — but every field except `offset` is untouched from the
      //   caller's own `request`, so it does.
      const page = yield* fetchPage({ ...request, offset } as Req);
      if (page.offset !== offset) {
        return yield* new UnifiPaginationInconsistent({
          reason: 'offset-mismatch',
          detail: `requested offset ${offset}, page echoed ${page.offset} -- rows may be duplicated or skipped`,
        });
      }
      if (totalCount !== undefined && page.totalCount !== totalCount) {
        return yield* new UnifiPaginationInconsistent({
          reason: 'total-count-changed',
          detail: `totalCount changed from ${totalCount} to ${page.totalCount} between page calls`,
        });
      }
      totalCount = page.totalCount;
      rows.push(...page.data);
      if (page.data.length === 0) break;
      offset += page.data.length;
      if (offset >= totalCount) break;
    }
    const expected = totalCount - startOffset;
    if (rows.length !== expected) {
      return yield* new UnifiPaginationInconsistent({
        reason: 'row-count-mismatch',
        detail: `collected ${rows.length} rows but totalCount(${totalCount}) - startOffset(${startOffset}) = ${expected}`,
      });
    }
    return rows;
  });
