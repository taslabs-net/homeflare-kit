/**
 * `Unifi.AclRule`'s `spec` against a fake UniFi Network API — mirrors `network.test.ts`/
 * `firewall-zone.test.ts`. `driftOf`/`matches` coverage lives here too, same as
 * `dns-policy.test.ts`, not split into its own file (see that file's own header).
 */
import { describe, expect, test } from 'bun:test';
import type * as aclRules from '@distilled.cloud/unifi-network/access_control_acl_rules';
import * as Retry from '@distilled.cloud/unifi-network/Retry';
import * as Effect from 'effect/Effect';
import { fakeFailure, fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import { attributesOf } from './acl-rule-form.ts';
import { driftOf, matches } from './acl-rule-drift.ts';
import { type AclRuleProps, declareAclRule, spec } from './acl-rule.ts';
import { unifiOperations } from './resource.ts';

const RULE_PATH = '/proxy/network/integration/v1/sites/site-1/acl-rules/rule-1';

const liveAclRule = (overrides: Partial<aclRules.ACLRule> = {}): aclRules.ACLRule => ({
  action: 'BLOCK',
  enabled: true,
  id: 'rule-1',
  index: 3,
  metadata: { origin: 'USER' },
  name: 'Block IoT to WAN',
  // ★ `IPV4` is the real `ACL rule` discriminator value (`type`: `IPV4`|`MAC`, `docs/unifi-acl-
  //   rule.md`) -- a prior fixture used the invented `NETWORK_TO_INTERNET`, corrected 2026-09-26.
  type: 'IPV4',
  protocolFilter: ['TCP', 'UDP'],
  // ★ `DEVICES` is the real `ACL rule device filter` discriminator value; the vendor has no
  //   "ALL_SWITCHES" variant -- omitting the field entirely means "all switches" per its own
  //   description ("When null, the rule will be provisioned to all switches on the site").
  enforcingDeviceFilter: { type: 'DEVICES', deviceIds: ['sw-1'] },
  ...overrides,
});

const PROPS: AclRuleProps = {
  siteId: 'site-1',
  aclRuleId: 'rule-1',
  action: 'BLOCK',
  enabled: true,
  name: 'Block IoT to WAN',
  type: 'IPV4',
  protocolFilter: ['TCP', 'UDP'],
  enforcingDeviceFilter: { type: 'DEVICES', deviceIds: ['sw-1'] },
};

describe('Unifi.AclRule spec.fetchLive', () => {
  test('a real GET response decodes into the typed live object', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === RULE_PATH
        ? Response.json(liveAclRule())
        : fakeFailure(400, 'unexpected request'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(live?.id).toBe('rule-1');
    expect(fake.seen).toEqual([{ method: 'GET', path: RULE_PATH }]);
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
    //   asserts the FAILURE, not the retry schedule. Regression for red-team Important finding 2:
    //   a blanket `Effect.orElseSucceed(() => undefined)` fold would pass every test above too.
    const fake = fakeUnifi(() => fakeFailure(500, 'boom'));
    const failure = await Effect.runPromise(
      Effect.flip(
        spec.fetchLive(PROPS).pipe(Retry.none, Effect.provide(fakeUnifiLayer(fake.fetch))),
      ),
    );
    expect(failure._tag).toBe('InternalServerError');
  });
});

describe('declareAclRule -- the declaration renderer', () => {
  test('its output matches attributesOf(live) by construction, for any live object', () => {
    const live = liveAclRule({ protocolFilter: ['UDP', 'TCP'], index: 9 });
    const declared = declareAclRule(live, 'site-1');
    const attrs = attributesOf(live, declared);
    expect(matches(attrs, declared)).toBe(true);
    expect(driftOf(live, declared)).toEqual([]);
  });
});

describe('driftOf -- B6 field-level drift, straight from one live read', () => {
  test('a real name change reports its own field, live and declared', () => {
    const live = liveAclRule({ name: 'Block cameras from WAN' });
    expect(driftOf(live, PROPS)).toEqual([
      { field: 'name', live: 'Block cameras from WAN', declared: 'Block IoT to WAN' },
    ]);
  });

  test('protocolFilter in a different order is a noop -- it is a SET, not a sequence', () => {
    const live = liveAclRule({ protocolFilter: ['UDP', 'TCP'] });
    expect(matches(attributesOf(live, PROPS), PROPS)).toBe(true);
    expect(driftOf(live, PROPS)).toEqual([]);
  });

  test('the DECLARED side of protocolFilter is also normalized, not just live (MEDIUM-4 mutant)', () => {
    const live = liveAclRule({ protocolFilter: ['TCP', 'UDP'] });
    const props: AclRuleProps = { ...PROPS, protocolFilter: ['UDP', 'TCP'] };
    expect(matches(attributesOf(live, props), props)).toBe(true);
    expect(driftOf(live, props)).toEqual([]);
  });

  test('a genuine protocolFilter difference is caught', () => {
    const live = liveAclRule({ protocolFilter: ['TCP'] });
    expect(driftOf(live, PROPS)).toEqual([
      { field: 'protocolFilter', live: ['TCP'], declared: ['TCP', 'UDP'] },
    ]);
  });

  test('enforcingDeviceFilter.deviceIds in a different order is a noop -- also a SET', () => {
    const live = liveAclRule({
      enforcingDeviceFilter: { type: 'DEVICES', deviceIds: ['sw-2', 'sw-1'] },
    });
    const props: AclRuleProps = {
      ...PROPS,
      enforcingDeviceFilter: { type: 'DEVICES', deviceIds: ['sw-1', 'sw-2'] },
    };
    expect(matches(attributesOf(live, props), props)).toBe(true);
    expect(driftOf(live, props)).toEqual([]);
  });

  test('index is never compared -- it is attributes-only (deprecated for writes, owned by ordering)', () => {
    const live = liveAclRule({ index: 41 });
    expect(matches(attributesOf(live, PROPS), PROPS)).toBe(true);
    expect(attributesOf(live, PROPS).index).toBe(41);
  });

  test('sourceFilter/destinationFilter stay opaque -- a real difference is still caught', () => {
    // `NETWORKS` + `networkIds` (plural, an array) is the real `IntegrationIpAclRuleNetworkEndpoint
    // FilterDto` shape -- a prior fixture used the invented singular `NETWORK`/`networkId`,
    // corrected 2026-09-26. `sourceFilter` is `unknown` either way, so this is a fixture-realism fix
    // only, not a behavior change.
    const live = liveAclRule({ sourceFilter: { type: 'NETWORKS', networkIds: ['net-1'] } });
    expect(driftOf(live, PROPS)).toEqual([
      {
        field: 'sourceFilter',
        live: { type: 'NETWORKS', networkIds: ['net-1'] },
        declared: undefined,
      },
    ]);
  });
});

describe('Unifi.AclRule write paths never reach the vendor API', () => {
  const ops = unifiOperations(spec);

  test('reconcile on an exact-match adoption (H6) makes no request but the one read', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === RULE_PATH
        ? Response.json(liveAclRule())
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
      method === 'GET' && url.pathname === RULE_PATH
        ? Response.json(liveAclRule())
        : fakeFailure(400, 'unexpected request'),
    );
    const exit = await Effect.runPromiseExit(
      ops.destroy(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(exit._tag).toBe('Failure');
    expect(fake.seen).toEqual([]);
  });
});
