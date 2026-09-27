/**
 * `Unifi.FirewallPolicy`'s `spec` against a fake UniFi Network API — mirrors `acl-rule.test.ts`/
 * `dns-policy.test.ts`.
 *
 * ⚠️ `driftOf`/`matches` coverage lives in `firewall-policy-drift.test.ts` (the field-level table
 *   plus I2's per-field completeness check) and `firewall-policy-filter-roundtrip.test.ts` (I1's
 *   filter-bearing round trip) — both split out to keep this file under the house 250-line cap once
 *   that coverage grew, same split `network-drift.test.ts` is from `network.test.ts`, not a
 *   different family. Red team, 2026-09-26.
 *
 * The last `describe` block is this family's own decode-proof of B0b's `pageAll` (T9) — not used by
 * `spec.fetchLive` itself (`getFirewallPolicy` reads one policy by id directly, same as
 * `acl-rule.ts`), but a real console's FirewallPolicy list is the one T9 names by scale (424 live
 * policies, `alchemy-ledger-network.md:13`) — `paginate.test.ts`'s own "against the real SDK" section
 * proves the pager's decode path against `networks.getNetworksOverviewPage`; this proves it against
 * `firewall.getFirewallPolicies`'s own page shape too, so a future Lane C import walking this
 * family's full list is walking a shape this suite has already exercised end to end.
 */
import { describe, expect, test } from 'bun:test';
import * as firewall from '@distilled.cloud/unifi-network/firewall';
import * as Retry from '@distilled.cloud/unifi-network/Retry';
import * as Effect from 'effect/Effect';
import { fakeFailure, fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import { attributesOf } from './firewall-policy-form.ts';
import { driftOf, matches } from './firewall-policy-drift.ts';
import { type FirewallPolicyProps, declareFirewallPolicy, spec } from './firewall-policy.ts';
import { pageAll } from './paginate.ts';
import { unifiOperations } from './resource.ts';

const POLICY_PATH = '/proxy/network/integration/v1/sites/site-1/firewall/policies/fp-1';

const liveFirewallPolicy = (
  overrides: Partial<firewall.FirewallPolicy> = {},
): firewall.FirewallPolicy => ({
  action: { type: 'ALLOW' },
  connectionStateFilter: ['ESTABLISHED', 'RELATED'],
  description: 'Allow IoT devices outbound to the internet',
  destination: { zoneId: 'zone-external' },
  enabled: true,
  id: 'fp-1',
  index: 3,
  ipProtocolScope: { ipVersion: 'IPV4' },
  loggingEnabled: false,
  metadata: { origin: 'USER' },
  name: 'Allow IoT to Internet',
  source: { zoneId: 'zone-iot' },
  ...overrides,
});

const PROPS: FirewallPolicyProps = {
  siteId: 'site-1',
  firewallPolicyId: 'fp-1',
  action: { type: 'ALLOW' },
  connectionStateFilter: ['ESTABLISHED', 'RELATED'],
  description: 'Allow IoT devices outbound to the internet',
  destination: { zoneId: 'zone-external' },
  enabled: true,
  ipProtocolScope: { ipVersion: 'IPV4' },
  loggingEnabled: false,
  name: 'Allow IoT to Internet',
  source: { zoneId: 'zone-iot' },
};

describe('Unifi.FirewallPolicy spec.fetchLive', () => {
  test('a real GET response decodes into the typed live object', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === POLICY_PATH
        ? Response.json(liveFirewallPolicy())
        : fakeFailure(400, 'unexpected request'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(live?.id).toBe('fp-1');
    expect(fake.seen).toEqual([{ method: 'GET', path: POLICY_PATH }]);
  });

  test('a genuine 404 folds to undefined -- never a false "unreadable" on anything else', async () => {
    const fake = fakeUnifi(() => fakeFailure(404, 'not found'));
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(live).toBeUndefined();
  });

  test('a 500 fails loudly -- only a genuine not-found may mean absent (T14)', async () => {
    // ⚠️ `Retry.none`: the default policy retries a 500 indefinitely with backoff -- this test
    //   asserts the FAILURE, not the retry schedule.
    const fake = fakeUnifi(() => fakeFailure(500, 'boom'));
    const failure = await Effect.runPromise(
      Effect.flip(
        spec.fetchLive(PROPS).pipe(Retry.none, Effect.provide(fakeUnifiLayer(fake.fetch))),
      ),
    );
    expect(failure._tag).toBe('InternalServerError');
  });
});

describe('declareFirewallPolicy -- the declaration renderer', () => {
  test('its output matches attributesOf(live) by construction, for any live object', () => {
    const live = liveFirewallPolicy({
      connectionStateFilter: ['RELATED', 'ESTABLISHED'],
      index: 9,
    });
    const declared = declareFirewallPolicy(live, 'site-1');
    const attrs = attributesOf(live, declared);
    expect(matches(attrs, declared)).toBe(true);
    expect(driftOf(live, declared)).toEqual([]);
  });
});

describe('Unifi.FirewallPolicy write paths never reach the vendor API', () => {
  const ops = unifiOperations(spec);

  test('reconcile on an exact-match adoption (H6) makes no request but the one read', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === POLICY_PATH
        ? Response.json(liveFirewallPolicy())
        : fakeFailure(400, 'unexpected request'),
    );
    const exit = await Effect.runPromiseExit(
      ops.reconcile(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(exit._tag).toBe('Success');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('reconcile on drift refuses instead of PATCHing/PUTting a merged body', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === POLICY_PATH
        ? Response.json(liveFirewallPolicy({ enabled: false }))
        : fakeFailure(400, 'unexpected request'),
    );
    const exit = await Effect.runPromiseExit(
      ops.reconcile(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(exit._tag).toBe('Failure');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('delete always refuses -- no DELETE is ever sent', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === POLICY_PATH
        ? Response.json(liveFirewallPolicy())
        : fakeFailure(400, 'unexpected request'),
    );
    const exit = await Effect.runPromiseExit(
      ops.destroy(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(exit._tag).toBe('Failure');
    expect(fake.seen).toEqual([]);
  });
});

describe("T9/B0b -- pageAll walks this family's own page shape (decode proof)", () => {
  test('every row across several pages of getFirewallPolicies decodes, in order', async () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      liveFirewallPolicy({ id: `fp-${i}`, index: i }),
    );
    const fake = fakeUnifi((method, url) => {
      if (
        method !== 'GET' ||
        url.pathname !== '/proxy/network/integration/v1/sites/site-1/firewall/policies'
      ) {
        return fakeFailure(400, 'unexpected request');
      }
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const limit = Number(url.searchParams.get('limit') ?? '3');
      const data = rows.slice(offset, offset + limit);
      return Response.json({ count: data.length, data, limit, offset, totalCount: rows.length });
    });

    const result = await Effect.runPromise(
      pageAll(firewall.getFirewallPolicies, { siteId: 'site-1', limit: 3 }).pipe(
        Effect.provide(fakeUnifiLayer(fake.fetch)),
      ),
    );

    expect(result.map((p) => p.id)).toEqual(rows.map((r) => r.id));
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
    expect(fake.seen).toHaveLength(3);
  });
});
