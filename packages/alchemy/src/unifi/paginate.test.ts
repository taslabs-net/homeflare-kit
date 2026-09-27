/**
 * `pageAll` (B0b/T9) — pure walk-logic tests against a synthetic fetcher, the three IMPORTANT-3
 * consistency checks (red team, 2026-09-26) against fetchers that lie the exact ways a real vendor
 * response could, and one integration test proving it type-checks and decodes against a REAL SDK
 * list operation (`getNetworksOverviewPage`) through the fake UniFi server. `M2`: this file does
 * not repeat the 404/500 decode tests `network.test.ts` already covers — those are about ONE
 * page's failure, not the walk this file exists to prove.
 *
 * ⛔ MINOR-3 (red team, 2026-09-26): `page.offset`/`page.totalCount` are wire-controlled values
 *   `@distilled.cloud/core` never validates (`wifi-broadcast.ts`'s header documents why), so the
 *   "malformed response" test below plants a non-numeric value in each and proves `paginate.ts`'s
 *   `numOrPlaceholder` keeps it out of the error text, instead of assuming a vendor response is
 *   always well-typed just because the SDK's TS types say so.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as networks from '@distilled.cloud/unifi-network/networks';
import { fakeFailure, fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import { type OffsetPage, UnifiPaginationInconsistent, pageAll } from './paginate.ts';

interface Row {
  readonly id: number;
}

/** A fake dataset served `pageSize` rows at a time, the same envelope every real list op uses —
 *  including `offset` echoed back exactly as requested, the honest case every OTHER test in this
 *  file deviates from on purpose. */
const fakePages = (rows: readonly Row[], pageSize: number) => {
  const calls: { offset: number; limit: number | undefined }[] = [];
  const fetchPage = (request: { offset?: number; limit?: number }) => {
    const offset = request.offset ?? 0;
    calls.push({ offset, limit: request.limit });
    return Effect.succeed<OffsetPage<Row>>({
      data: rows.slice(offset, offset + pageSize),
      offset,
      totalCount: rows.length,
    });
  };
  return { calls, fetchPage };
};

const flip = <A>(effect: Effect.Effect<A, UnifiPaginationInconsistent>) =>
  Effect.runPromise(Effect.flip(effect));

describe('pageAll -- walk logic', () => {
  test('walks every page in order and returns every row exactly once', async () => {
    const rows = Array.from({ length: 7 }, (_, id) => ({ id }));
    const { calls, fetchPage } = fakePages(rows, 3);

    const result = await Effect.runPromise(pageAll(fetchPage, { limit: 3 }));

    expect(result).toEqual(rows);
    expect(calls).toEqual([
      { offset: 0, limit: 3 },
      { offset: 3, limit: 3 },
      { offset: 6, limit: 3 },
    ]);
  });

  test('a single page under the limit stops after one call', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const { calls, fetchPage } = fakePages(rows, 10);

    const result = await Effect.runPromise(pageAll(fetchPage, { limit: 10 }));

    expect(result).toEqual(rows);
    expect(calls).toHaveLength(1);
  });

  test('zero rows total makes exactly one call and returns empty', async () => {
    const { calls, fetchPage } = fakePages([], 5);

    const result = await Effect.runPromise(pageAll(fetchPage, { limit: 5 }));

    expect(result).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  test('T9: keeps paging on totalCount even when every page is short of the limit', async () => {
    // A page shorter than `limit` is NOT by itself "last page" -- only `totalCount` is. This
    // fetcher returns exactly one row per call (as if capped server-side, independent of `limit`)
    // while `totalCount` says three exist; a pager that stopped on `data.length < limit` would
    // truncate after the FIRST call and silently drop rows 2 and 3 -- the exact T9 failure mode.
    const offsetsSeen: number[] = [];
    const fetchPage = (request: { offset?: number; limit?: number }) => {
      const offset = request.offset ?? 0;
      offsetsSeen.push(offset);
      return Effect.succeed<OffsetPage<Row>>({ data: [{ id: offset }], offset, totalCount: 3 });
    };

    const result = await Effect.runPromise(pageAll(fetchPage, { limit: 10 }));

    expect(result).toEqual([{ id: 0 }, { id: 1 }, { id: 2 }]);
    expect(offsetsSeen).toEqual([0, 1, 2]);
  });

  test('resumes from a caller-given offset instead of always starting at 0', async () => {
    const rows = Array.from({ length: 5 }, (_, id) => ({ id }));
    const { calls, fetchPage } = fakePages(rows, 2);

    const result = await Effect.runPromise(pageAll(fetchPage, { offset: 2, limit: 2 }));

    expect(result).toEqual(rows.slice(2));
    expect(calls[0]).toEqual({ offset: 2, limit: 2 });
  });

  test('a failure from one page propagates instead of being swallowed', async () => {
    const boom = new Error('boom');
    const fetchPage = () => Effect.fail(boom);

    const result = await Effect.runPromise(Effect.flip(pageAll(fetchPage, { limit: 5 })));

    expect(result).toBe(boom);
  });
});

describe('pageAll -- IMPORTANT-3: typed failures on a self-contradicting response', () => {
  test('the server ignoring offset (always echoing 0) fails as offset-mismatch, not an infinite loop', async () => {
    let calls = 0;
    const fetchPage = () => {
      calls += 1;
      // Always answers page 1, regardless of the requested offset -- the "offset ignored" trap.
      return Effect.succeed<OffsetPage<Row>>({
        data: [{ id: 1 }, { id: 2 }],
        offset: 0,
        totalCount: 5,
      });
    };

    const failure = await flip(pageAll(fetchPage, { limit: 2 }));

    expect(failure).toBeInstanceOf(UnifiPaginationInconsistent);
    expect(failure.reason).toBe('offset-mismatch');
    // The FIRST page (offset 0 requested, 0 echoed) is fine; the SECOND (offset 2 requested, 0
    // echoed) is what trips it -- proving this stops the walk instead of cycling forever.
    expect(calls).toBe(2);
  });

  test('totalCount drifting between calls fails as total-count-changed', async () => {
    let call = 0;
    const fetchPage = (request: { offset?: number; limit?: number }) => {
      call += 1;
      const offset = request.offset ?? 0;
      // A row is removed after the first page is read -- totalCount drops from 3 to 2.
      return Effect.succeed<OffsetPage<Row>>({
        data: [{ id: offset }],
        offset,
        totalCount: call === 1 ? 3 : 2,
      });
    };

    const failure = await flip(pageAll(fetchPage, { limit: 1 }));

    expect(failure.reason).toBe('total-count-changed');
  });

  test('an undercounted totalCount fails loudly instead of silently truncating (T9)', async () => {
    // The exact scenario named in review: totalCount says 0 but the vendor still returns real
    // rows on the one page fetched before the loop (correctly) stops on totalCount -- the OLD
    // behavior returned those 2 rows as if they were the complete, correct answer.
    const fetchPage = () =>
      Effect.succeed<OffsetPage<Row>>({ data: [{ id: 1 }, { id: 2 }], offset: 0, totalCount: 0 });

    const failure = await flip(pageAll(fetchPage, { limit: 10 }));

    expect(failure.reason).toBe('row-count-mismatch');
  });

  test('a walk that never reaches totalCount fails at the page ceiling instead of looping forever', async () => {
    // Offset IS honored (so this never trips offset-mismatch first) but totalCount is inflated far
    // past what MAX_PAGES worth of single-row pages could ever reach -- the walk is internally
    // consistent page-to-page, just never converges, which only the ceiling can catch.
    const fetchPage = (request: { offset?: number; limit?: number }) =>
      Effect.succeed<OffsetPage<Row>>({
        data: [{ id: request.offset ?? 0 }],
        offset: request.offset ?? 0,
        totalCount: 1_000_000,
      });

    const failure = await flip(pageAll(fetchPage, { limit: 1 }));

    expect(failure.reason).toBe('page-ceiling');
  });

  test('a non-numeric offset/totalCount from a malformed response never appears in the error text (MINOR-3)', async () => {
    const SENTINEL = 'sentinel-do-not-log-me';
    // Cast, not a typo: the SDK's TS types say `offset`/`totalCount` are numbers, but nothing
    // validates that at runtime -- this is exactly the shape a genuinely malformed page could take.
    const fetchPage = () =>
      Effect.succeed({
        data: [],
        offset: SENTINEL,
        totalCount: SENTINEL,
      } as unknown as OffsetPage<Row>);

    const failure = await flip(pageAll(fetchPage, {}));

    expect(failure.reason).toBe('offset-mismatch');
    expect(failure.detail).not.toContain(SENTINEL);
    expect(failure.message).not.toContain(SENTINEL);
  });

  test('an honest, well-behaved server never trips any of the three checks', async () => {
    const rows = Array.from({ length: 9 }, (_, id) => ({ id }));
    const { fetchPage } = fakePages(rows, 4);

    const result = await Effect.runPromise(pageAll(fetchPage, { limit: 4 }));

    expect(result).toEqual(rows);
  });
});

describe('pageAll -- against the real SDK (decode proof)', () => {
  test('walks two real pages of getNetworksOverviewPage through the fake server', async () => {
    const allNetworks = Array.from({ length: 3 }, (_, i) => ({
      default: i === 0,
      enabled: true,
      id: `net-${i}`,
      management: 'ADVANCED',
      metadata: { origin: 'USER' as const },
      name: `Network ${i}`,
      vlanId: i + 1,
    }));
    const fake = fakeUnifi((method, url) => {
      if (
        method !== 'GET' ||
        url.pathname !== '/proxy/network/integration/v1/sites/site-1/networks'
      ) {
        return fakeFailure(400, 'unexpected request');
      }
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const limit = Number(url.searchParams.get('limit') ?? '2');
      return Response.json({
        count: allNetworks.slice(offset, offset + limit).length,
        data: allNetworks.slice(offset, offset + limit),
        limit,
        offset,
        totalCount: allNetworks.length,
      });
    });

    const result = await Effect.runPromise(
      pageAll(networks.getNetworksOverviewPage, { siteId: 'site-1', limit: 2 }).pipe(
        Effect.provide(fakeUnifiLayer(fake.fetch)),
      ),
    );

    expect(result.map((n) => n.id)).toEqual(['net-0', 'net-1', 'net-2']);
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
    expect(fake.seen).toHaveLength(2);
  });
});
