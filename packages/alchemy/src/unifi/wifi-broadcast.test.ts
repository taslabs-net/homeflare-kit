/**
 * `Unifi.WifiBroadcast`'s `spec` against a fake UniFi Network API, proving the real distilled wire
 * path THROUGH `pageAll` (path assembly, JSON decode, `NotFound` folding, the pagination walk this
 * family is the first resource to actually need), the declaration renderer, and — the task's own
 * requirement — that no handler this family exposes ever sends a non-`GET` request.
 *
 * ⚠️ THE PASSPHRASE-SPECIFIC PROOFS (T23 sentinel + forced-decode-failure) LIVE IN
 *   `wifi-broadcast-secrets.test.ts`, SPLIT OUT — same reason `errors-and-secrets.test.ts` is its
 *   own file rather than folded into `network.test.ts`: keeps this file under the house line cap
 *   and keeps the security-critical assertions in one place a reviewer can find by name.
 */
import { describe, expect, test } from 'bun:test';
import type * as wifiBroadcasts from '@distilled.cloud/unifi-network/wifi_broadcasts';
import * as Retry from '@distilled.cloud/unifi-network/Retry';
import * as Effect from 'effect/Effect';
import { fakeFailure, fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import { attributesOf } from './wifi-broadcast-form.ts';
import { matches } from './wifi-broadcast-drift.ts';
import { type WifiBroadcastProps, declareWifiBroadcast, spec } from './wifi-broadcast.ts';
import { unifiOperations } from './resource.ts';

const PAGE_PATH = '/proxy/network/integration/v1/sites/site-1/wifi/broadcasts';

const liveOverview = (
  overrides: Partial<wifiBroadcasts.WifiBroadcastOverview> = {},
): wifiBroadcasts.WifiBroadcastOverview => ({
  enabled: true,
  id: 'wifi-1',
  metadata: { origin: 'USER' },
  name: 'Guest',
  type: 'STANDARD',
  securityConfiguration: { type: 'WPA_PERSONAL', presharedKeyNetworkIds: [{ type: 'VLAN' }] },
  ...overrides,
});

const PROPS: WifiBroadcastProps = {
  siteId: 'site-1',
  wifiBroadcastId: 'wifi-1',
  name: 'Guest',
  enabled: true,
  type: 'STANDARD',
  securityConfiguration: { type: 'WPA_PERSONAL', presharedKeyNetworkIds: [{ type: 'VLAN' }] },
};

/** One page's worth of the shared list envelope every UniFi list op answers. `total` is the
 *  FULL row count across every page, never just this page's own `rows.length` -- pageAll stops
 *  once `offset` reaches it (`paginate.ts`), so getting this wrong silently truncates the walk. */
const pageResponse = (
  rows: readonly wifiBroadcasts.WifiBroadcastOverview[],
  offset: number,
  total = rows.length,
) =>
  Response.json({
    count: rows.length,
    data: rows,
    limit: rows.length || 1,
    offset,
    totalCount: total,
  });

describe('Unifi.WifiBroadcast spec.fetchLive', () => {
  test('a single-page GET response decodes and finds the matching row', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === PAGE_PATH
        ? pageResponse([liveOverview()], 0)
        : fakeFailure(400, 'unexpected request'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(live?.id).toBe('wifi-1');
    expect(fake.seen).toEqual([{ method: 'GET', path: `${PAGE_PATH}?offset=0` }]);
  });

  test('the row can be on a LATER page -- pageAll actually walks (T9/B0b)', async () => {
    const rows = [liveOverview({ id: 'wifi-0', name: 'Other' }), liveOverview({ id: 'wifi-1' })];
    const fake = fakeUnifi((method, url) => {
      if (method !== 'GET' || url.pathname !== PAGE_PATH) return fakeFailure(400, 'unexpected');
      const offset = Number(url.searchParams.get('offset') ?? '0');
      return pageResponse(rows.slice(offset, offset + 1), offset, rows.length);
    });
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(live?.id).toBe('wifi-1');
    expect(fake.seen.length).toBeGreaterThan(1);
  });

  test('present rows but no matching id folds to undefined -- no separate "not found" signal', async () => {
    const fake = fakeUnifi(() => pageResponse([liveOverview({ id: 'someone-else' })], 0));
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(live).toBeUndefined();
  });

  test('a genuine 404 (site not found) folds to undefined', async () => {
    const fake = fakeUnifi(() => fakeFailure(404, 'not found'));
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(live).toBeUndefined();
  });

  test('a 500 fails loudly -- only a genuine not-found may mean absent', async () => {
    // ⚠️ `Retry.none`: the default policy retries a 500 indefinitely with backoff -- this test
    //   asserts the FAILURE, not the retry schedule (same reason `network.test.ts`'s 500 test needs it).
    const fake = fakeUnifi(() => fakeFailure(500, 'boom'));
    const failure = await Effect.runPromise(
      Effect.flip(
        spec.fetchLive(PROPS).pipe(Retry.none, Effect.provide(fakeUnifiLayer(fake.fetch))),
      ),
    );
    expect(failure._tag).toBe('InternalServerError');
  });
});

describe('declareWifiBroadcast -- the declaration renderer', () => {
  test('its output matches attributesOf(live) by construction, for any live object', () => {
    const live = liveOverview({ name: 'Employees', enabled: false });
    const declared = declareWifiBroadcast(live, 'site-1');
    const attrs = attributesOf(live, declared);
    expect(matches(attrs, declared)).toBe(true);
  });
});

describe('Unifi.WifiBroadcast write paths never reach the vendor API', () => {
  const ops = unifiOperations(spec);

  test('reconcile on an exact-match adoption (H6) sends only GETs', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === PAGE_PATH
        ? pageResponse([liveOverview()], 0)
        : fakeFailure(400, 'unexpected request'),
    );
    const exit = await Effect.runPromiseExit(
      ops.reconcile(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(exit._tag).toBe('Success');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('delete always refuses -- no DELETE is ever sent', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === PAGE_PATH
        ? pageResponse([liveOverview()], 0)
        : fakeFailure(400, 'unexpected request'),
    );
    const exit = await Effect.runPromiseExit(
      ops.destroy(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(exit._tag).toBe('Failure');
    expect(fake.seen).toEqual([]);
  });
});
