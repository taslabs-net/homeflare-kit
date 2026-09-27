/**
 * T23 runtime proof for `Unifi.WifiBroadcast`, split from `wifi-broadcast.test.ts` for the same
 * reason `errors-and-secrets.test.ts` is split from `network.test.ts`: keeps the security-critical
 * assertions in one file a reviewer can find by name, under the house line cap.
 *
 * ★ WHY THE SENTINEL IS INJECTED INTO `securityConfiguration` DIRECTLY ON THE WIRE, NOT VIA A
 *   `WifiBroadcastOverview` TYPE. `WifiSecurityConfigurationOverview` has no `passphrase` field —
 *   that is the whole point of `wifi-broadcast-form.ts`'s design (see its header) — so there is no
 *   TYPED way to construct a fixture that carries one. The raw JSON fixture below simulates the
 *   one thing the type system CANNOT rule out: a vendor bug or a future console version that puts
 *   a passphrase-shaped key on the overview response anyway. `errors-and-secrets.test.ts` already
 *   proves the SDK's OWN details-call schema redacts a real `passphrase` field to `Redacted`; this
 *   file proves the different, narrower claim the overview path needs: even an UNDECLARED key with
 *   that name surviving decode never reaches this family's attributes, declaration or a forced
 *   error path.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import { attributesOf } from './wifi-broadcast-form.ts';
import { type WifiBroadcastProps, declareWifiBroadcast, spec } from './wifi-broadcast.ts';

const PAGE_PATH = '/proxy/network/integration/v1/sites/site-1/wifi/broadcasts';

// A fabricated sentinel, not a real WiFi passphrase (kit is PUBLIC — see fake-unifi.ts).
const SENTINEL = 'sentinel-wpa-passphrase-do-not-log-me';

const PROPS: WifiBroadcastProps = {
  siteId: 'site-1',
  wifiBroadcastId: 'wifi-1',
  name: 'Guest',
  enabled: true,
  type: 'STANDARD',
  securityConfiguration: { type: 'WPA_PERSONAL' },
};

/**
 * One base row per nested location a stray key could hide in — red team, IMPORTANT-1 (2026-09-26):
 * the original version of this file only planted the sentinel on `securityConfiguration` itself
 * and missed that `sortedRefs`/`network`/`hotspotConfiguration`/`broadcastingDeviceFilter` all
 * passed their OWN object through unchanged (`network`/`hotspotConfiguration` assigned directly;
 * `presharedKeyNetworkIds` elements returned as received; `broadcastingDeviceFilter` spread with
 * `{...value}`). Each case below plants the SAME sentinel in a different one of those four spots —
 * `IntegrationWifiPresharedKeyDto`'s own shape (`{network, passphrase}`, SDK `wifi_broadcasts.ts`)
 * is exactly why a `presharedKeyNetworkIds` element is the most plausible leak site of the four.
 */
const baseRow = {
  enabled: true,
  id: 'wifi-1',
  metadata: { origin: 'USER' },
  name: 'Guest',
  type: 'STANDARD',
};

const NESTED_SENTINEL_CASES: Record<string, unknown> = {
  'top-level securityConfiguration': {
    ...baseRow,
    securityConfiguration: {
      type: 'WPA_PERSONAL',
      presharedKeyNetworkIds: [{ type: 'VLAN' }],
      passphrase: SENTINEL,
    },
  },
  'a presharedKeyNetworkIds element (IntegrationWifiPresharedKeyDto shape)': {
    ...baseRow,
    securityConfiguration: {
      type: 'WPA_PERSONAL',
      presharedKeyNetworkIds: [{ type: 'VLAN', networkId: 'net-1', passphrase: SENTINEL }],
    },
  },
  network: {
    ...baseRow,
    network: { type: 'STANDARD', networkId: 'net-1', passphrase: SENTINEL },
    securityConfiguration: { type: 'WPA_PERSONAL' },
  },
  hotspotConfiguration: {
    ...baseRow,
    hotspotConfiguration: { type: 'PASSPOINT', radiusSharedSecret: SENTINEL },
    securityConfiguration: { type: 'WPA_PERSONAL' },
  },
  broadcastingDeviceFilter: {
    ...baseRow,
    broadcastingDeviceFilter: {
      type: 'CUSTOM',
      deviceIds: ['dev-1'],
      radiusSharedSecret: SENTINEL,
    },
    securityConfiguration: { type: 'WPA_PERSONAL' },
  },
};

describe('T23 — a stray passphrase-shaped key on the wire never survives fetch -> attrs -> declare -> render', () => {
  for (const [label, rawRow] of Object.entries(NESTED_SENTINEL_CASES)) {
    test(`sentinel-passphrase test: ${label}`, async () => {
      const fake = fakeUnifi((method, url) =>
        method === 'GET' && url.pathname === PAGE_PATH
          ? Response.json({ count: 1, data: [rawRow], limit: 1, offset: 0, totalCount: 1 })
          : new Response('unexpected request', { status: 400 }),
      );
      const live = await Effect.runPromise(
        spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
      );

      // ⚠️ FETCH: documents the real risk, rather than assuming it away — nothing in
      //   `@distilled.cloud/core`'s wire key-mapping strips a key the schema does not declare (see
      //   `wifi-broadcast-form.ts`'s header). If this assertion ever starts failing because a future
      //   core/SDK regen DOES start stripping unknown keys, that is a welcome, stronger guarantee —
      //   not a reason this test needs to keep asserting the weaker one.
      expect(JSON.stringify(live)).toContain(SENTINEL);
      if (live === undefined) throw new Error('expected the fake page to decode a row');

      // ATTRS: `attributesOf` rebuilds every nested object field by field (never `{...live}`,
      // never assigning a nested object through unchanged).
      const attrs = attributesOf(live, PROPS);
      expect(JSON.stringify(attrs)).not.toContain(SENTINEL);

      // DECLARE: `declareWifiBroadcast` is the same discipline, independently.
      const declared = declareWifiBroadcast(live, 'site-1');
      expect(JSON.stringify(declared)).not.toContain(SENTINEL);

      // RENDER: the literal text a later import script would write into `alchemy.run.ts`.
      const rendered = `wifiBroadcast(${JSON.stringify('wifi-1')}, ${JSON.stringify(declared)})`;
      expect(rendered).not.toContain(SENTINEL);
    });
  }

  test('forced decode-failure test: a malformed page body fails typed, without echoing the sentinel', async () => {
    // A non-JSON 200 body (a genuine decode failure, not a mapped HTTP error) that happens to
    // CONTAIN a sentinel value, the way a garbled proxy/debug response might. `getWifiBroadcastPage`
    // has no schema to reject this against (see `wifi-broadcast-form.ts`'s header) — it decodes as
    // the raw string, which fails `pageAll`'s own OWN consistency check instead (`paginate.ts`):
    // the fake "page" has no `.offset`, so the walk cannot proceed and refuses to trust it.
    const fake = fakeUnifi(() => new Response(`malformed body ${SENTINEL}`, { status: 200 }));
    const failure = await Effect.runPromise(
      Effect.flip(spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch)))),
    );

    expect(failure._tag).toBe('UnifiPaginationInconsistent');
    // The error's OWN fields (`reason`/`detail`) are built entirely from offsets and counts
    // (`paginate.ts`) — never from the raw response body — so neither they nor the `.message`
    // getter built from them can ever echo the sentinel, regardless of what garbled text arrived.
    expect(JSON.stringify(failure)).not.toContain(SENTINEL);
    expect((failure as { message: string }).message).not.toContain(SENTINEL);
  });
});
