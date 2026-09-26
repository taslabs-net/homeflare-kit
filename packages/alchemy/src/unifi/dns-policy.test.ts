/**
 * `Unifi.DnsPolicy`'s `spec` against a fake UniFi Network API — mirrors `network.test.ts`/
 * `firewall-zone.test.ts`. `driftOf`/`matches` coverage lives here too (not split into its own
 * file, unlike `network-drift.test.ts`): this family's field list is flat scalars only, so there
 * is no unordered-array normalizer to exercise and the whole file stays well under the house cap.
 */
import { describe, expect, test } from 'bun:test';
import type * as dnsPolicies from '@distilled.cloud/unifi-network/dns_policies';
import * as Effect from 'effect/Effect';
import { fakeFailure, fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import { attributesOf } from './dns-policy-form.ts';
import { driftOf, matches } from './dns-policy-drift.ts';
import { type DnsPolicyProps, declareDnsPolicy, spec } from './dns-policy.ts';
import { unifiOperations } from './resource.ts';

const POLICY_PATH = '/proxy/network/integration/v1/sites/site-1/dns/policies/dns-1';

const liveDnsPolicy = (overrides: Partial<dnsPolicies.DNSPolicy> = {}): dnsPolicies.DNSPolicy => ({
  enabled: true,
  id: 'dns-1',
  metadata: { origin: 'USER' },
  type: 'A',
  domain: 'cameras.example.test',
  ipv4Address: '192.0.2.10',
  ttlSeconds: 300,
  ...overrides,
});

const PROPS: DnsPolicyProps = {
  siteId: 'site-1',
  dnsPolicyId: 'dns-1',
  enabled: true,
  type: 'A',
  domain: 'cameras.example.test',
  ipv4Address: '192.0.2.10',
  ttlSeconds: 300,
};

describe('Unifi.DnsPolicy spec.fetchLive', () => {
  test('a real GET response decodes into the typed live object', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === POLICY_PATH
        ? Response.json(liveDnsPolicy())
        : fakeFailure(400, 'unexpected request'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(live?.id).toBe('dns-1');
    expect(fake.seen).toEqual([{ method: 'GET', path: POLICY_PATH }]);
  });

  test('a genuine 404 folds to undefined -- never a false "unreadable" on anything else', async () => {
    const fake = fakeUnifi(() => fakeFailure(404, 'not found'));
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(live).toBeUndefined();
  });
});

describe('declareDnsPolicy -- the declaration renderer', () => {
  test('its output matches attributesOf(live) by construction, for any live object', () => {
    // A record shape with a DIFFERENT set of fields present than `liveDnsPolicy`'s default (a
    // TXT record has no `domain`/`ipv4Address`/`ttlSeconds`) -- a fresh literal, not the `A`
    // record fixture's overrides, so no field is merely omitted from an override that would
    // otherwise still carry the base fixture's value.
    const live: dnsPolicies.DNSPolicy = {
      enabled: true,
      id: 'dns-2',
      metadata: { origin: 'USER' },
      type: 'TXT',
      text: '"v=spf1 -all"',
    };
    const declared = declareDnsPolicy(live, 'site-1');
    const attrs = attributesOf(live, declared);
    expect(matches(attrs, declared)).toBe(true);
    expect(driftOf(live, declared)).toEqual([]);
  });
});

describe('driftOf -- B6 field-level drift, straight from one live read', () => {
  test('a drifted field reports its own live and declared values, by name', () => {
    const live = liveDnsPolicy({ ttlSeconds: 60 });
    expect(driftOf(live, PROPS)).toEqual([{ field: 'ttlSeconds', live: 60, declared: 300 }]);
  });

  test('a live `null` for an unset optional field is a noop, not a spurious update', () => {
    // UniFi's JSON answers `null` for an unset optional (see `dns-policy-drift.ts`'s header);
    // the double cast lands `null` at runtime past what the SDK's `T | undefined` types allow.
    const live = { ...liveDnsPolicy(), ipv6Address: null } as unknown as dnsPolicies.DNSPolicy;
    expect(matches(attributesOf(live, PROPS), PROPS)).toBe(true);
    expect(driftOf(live, PROPS)).toEqual([]);
  });
});

describe('Unifi.DnsPolicy write paths never reach the vendor API', () => {
  const ops = unifiOperations(spec);

  test('reconcile on an exact-match adoption (H6) makes no request but the one read', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === POLICY_PATH
        ? Response.json(liveDnsPolicy())
        : fakeFailure(400, 'unexpected request'),
    );
    const exit = await Effect.runPromiseExit(
      ops.reconcile(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(exit._tag).toBe('Success');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('reconcile on drift refuses instead of PUTting a merged body', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === POLICY_PATH
        ? Response.json(liveDnsPolicy({ ttlSeconds: 999 }))
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
        ? Response.json(liveDnsPolicy())
        : fakeFailure(400, 'unexpected request'),
    );
    const exit = await Effect.runPromiseExit(
      ops.destroy(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(exit._tag).toBe('Failure');
    expect(fake.seen).toEqual([]);
  });
});
