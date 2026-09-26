/**
 * `pageAll` (B0b/T9) — pure walk-logic tests against a synthetic fetcher, plus one integration
 * test proving it type-checks and decodes against a REAL SDK list operation
 * (`getNetworksOverviewPage`) through the fake UniFi server. `M2`: this file does not repeat the
 * 404/500 decode tests `network.test.ts` already covers — those are about ONE page's failure, not
 * the walk this file exists to prove.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as networks from '@distilled.cloud/unifi-network/networks';
import { fakeFailure, fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import { type OffsetPage, pageAll } from './paginate.ts';

interface Row {
  readonly id: number;
}

/** A fake dataset served `pageSize` rows at a time, the same envelope every real list op uses. */
const fakePages = (rows: readonly Row[], pageSize: number) => {
  const calls: { offset: number; limit: number | undefined }[] = [];
  const fetchPage = (request: { offset?: number; limit?: number }) => {
    const offset = request.offset ?? 0;
    calls.push({ offset, limit: request.limit });
    return Effect.succeed<OffsetPage<Row>>({
      data: rows.slice(offset, offset + pageSize),
      totalCount: rows.length,
    });
  };
  return { calls, fetchPage };
};

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
      return Effect.succeed<OffsetPage<Row>>({ data: [{ id: offset }], totalCount: 3 });
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
