/**
 * Runtime proof for A12 (T8/T23): the distilled regen's two behavioral changes actually decode
 * through the real fake-fetch path every other `*.test.ts` in this family uses — not just typecheck.
 *
 * ⛔ WITHOUT THESE, A FUTURE REGEN THAT DROPS `sensitivePatterns` OR `errorEnvelope` STAYS GREEN.
 *   Every other test here fixes response bodies before A2/A1 landed, so none of them would notice
 *   either regressing back to a plain string / an always-`undefined` envelope.
 */
import { describe, expect, test } from 'bun:test';
import * as wifiBroadcasts from '@distilled.cloud/unifi-network/wifi_broadcasts';
import * as applicationInfo from '@distilled.cloud/unifi-network/application_info';
import * as Retry from '@distilled.cloud/unifi-network/Retry';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';
import { fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';

const WIFI_PATH = '/proxy/network/integration/v1/sites/site-1/wifi/broadcasts/wifi-1';

// A fabricated sentinel, not a real WiFi passphrase (kit is PUBLIC — see fake-unifi.ts).
const SENTINEL = 'sentinel-wpa-passphrase-do-not-log-me';

const liveWifiBroadcast = () => ({
  channel2gLockedTo6: false,
  clientIsolationEnabled: false,
  dtimPeriod2gLockedTo3: false,
  enabled: true,
  hideName: false,
  id: 'wifi-1',
  metadata: { origin: 'USER' },
  multicastToUnicastConversionEnabled: false,
  name: 'Guest',
  type: 'STANDARD',
  securityConfiguration: {
    type: 'WPA_PERSONAL',
    passphrase: SENTINEL,
    presharedKeys: [{ network: { type: 'VLAN', networkId: 'net-1' }, passphrase: SENTINEL }],
  },
});

describe('A2/T23 — WPA/PPSK passphrase decodes Redacted, not a plain string', () => {
  test('both the single passphrase and every PPSK entry come back Redacted', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === WIFI_PATH
        ? Response.json(liveWifiBroadcast())
        : new Response('unexpected request', { status: 400 }),
    );
    const live = await Effect.runPromise(
      wifiBroadcasts
        .getWifiBroadcastDetails({ siteId: 'site-1', wifiBroadcastId: 'wifi-1' })
        .pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    const { passphrase, presharedKeys } = live.securityConfiguration;
    expect(Redacted.isRedacted(passphrase)).toBe(true);
    expect(Redacted.value(passphrase as Redacted.Redacted<string>)).toBe(SENTINEL);
    expect(Redacted.isRedacted(presharedKeys?.[0]?.passphrase)).toBe(true);
  });

  test('neither JSON.stringify nor String() ever shows the sentinel value', async () => {
    const fake = fakeUnifi(() => Response.json(liveWifiBroadcast()));
    const live = await Effect.runPromise(
      wifiBroadcasts
        .getWifiBroadcastDetails({ siteId: 'site-1', wifiBroadcastId: 'wifi-1' })
        .pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(JSON.stringify(live)).not.toContain(SENTINEL);
    expect(String(live.securityConfiguration.passphrase)).not.toContain(SENTINEL);
  });
});

/** The pinned spec's `Error Message` schema (T8) — see `src/protocol.ts`'s module doc. */
const envelopeBody = (over: Record<string, unknown> = {}) => ({
  code: 'api.example.not-found',
  message: 'vendor-provided failure text',
  requestId: 'req-sentinel-1',
  requestPath: '/v1/sites/site-1/secret-console-path',
  statusCode: 404,
  statusName: 'Not Found',
  timestamp: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('A1/T8 — the vendor Error Message envelope actually decodes', () => {
  test('a mapped status (404) carries the vendor message, not a bare "HTTP 404"', async () => {
    const fake = fakeUnifi(() => Response.json(envelopeBody(), { status: 404 }));
    const failure = await Effect.runPromise(
      Effect.flip(applicationInfo.getInfo({}).pipe(Effect.provide(fakeUnifiLayer(fake.fetch)))),
    );
    expect(failure._tag).toBe('NotFound');
    expect((failure as { message?: string }).message).toBe('vendor-provided failure text');
  });

  test('an unmapped status (418) becomes UnknownUnifiNetworkError with the extra envelope fields', async () => {
    // ⚠️ `Retry.none`: `UnknownUnifiNetworkError` is tagged a retryable server error by core's
    //   default policy regardless of the actual (client, 4xx) status — this test asserts the
    //   FAILURE, not the retry schedule (same reason `network.test.ts`'s 500 test needs it).
    const fake = fakeUnifi(() =>
      Response.json(envelopeBody({ statusCode: 418, statusName: "I'm a teapot" }), {
        status: 418,
      }),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        applicationInfo.getInfo({}).pipe(Retry.none, Effect.provide(fakeUnifiLayer(fake.fetch))),
      ),
    );
    expect(failure._tag).toBe('UnknownUnifiNetworkError');
    const err = failure as unknown as {
      code?: string;
      requestId?: string;
      statusCode?: number;
      statusName?: string;
      timestamp?: string;
      body: unknown;
    };
    expect(err.code).toBe('api.example.not-found');
    expect(err.requestId).toBe('req-sentinel-1');
    expect(err.statusCode).toBe(418);
    expect(err.statusName).toBe("I'm a teapot");
    expect(err.timestamp).toBe('2026-01-01T00:00:00.000Z');
    // T3: requestPath is never plucked into its own field or into `message` …
    expect('requestPath' in err).toBe(false);
    // … but it IS still inside the raw body for anyone who reads that on purpose (README/errors.ts).
    expect((err.body as { requestPath?: string }).requestPath).toBe(
      '/v1/sites/site-1/secret-console-path',
    );
  });
});
