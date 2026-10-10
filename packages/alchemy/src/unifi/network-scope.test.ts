/**
 * `Unifi.Network`'s write SCOPE (`network-scope.ts`), identity check, no-retry PUT and message
 * wording — red team round 1 on PR 377. Drives `unifiOperations(spec).reconcile` against `fakeUnifi`,
 * so the real SDK `updateNetwork` assembles the request and the fake records every one.
 */
import { describe, expect, test } from 'bun:test';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import { fakeFailure, fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import { type NetworkProps, spec } from './network.ts';
import { UnifiLiveDriftedSinceDeploy, UnifiUpdateDidNotConverge } from './policy.ts';
import { unifiOperations } from './resource.ts';

const PATH = '/proxy/network/integration/v1/sites/site-1/networks/net-1';
const IPV6 = {
  interfaceType: 'STATIC',
  prefixLength: 64,
  hostIpAddress: '2602:f660:0:16::254',
  clientAddressAssignment: { slaacEnabled: true },
  routerAdvertisement: { priority: 'HIGH' },
};
const BASE: NetworkProps = {
  siteId: 'site-1',
  networkId: 'net-1',
  name: 'Compute',
  enabled: true,
  management: 'ADVANCED',
  vlanId: 16,
  dhcpGuarding: { trustedDhcpServerIpAddresses: ['10.0.0.1'] },
  ipv4Configuration: { dhcpConfiguration: { mode: 'SERVER' }, hostIpAddress: '10.20.16.254' },
};
const WITH_V6 = { ...BASE, ipv6Configuration: IPV6 } as NetworkProps;

const live = (extra: Record<string, unknown> = {}) => ({
  id: 'net-1',
  default: false,
  metadata: { origin: 'USER' },
  ...BASE,
  siteId: undefined,
  networkId: undefined,
  ...extra,
});

const run = (
  liveBody: object,
  news: NetworkProps,
  olds: NetworkProps,
  put: () => Response = () => Response.json(liveBody),
) => {
  const fake = fakeUnifi((method, url) =>
    url.pathname === PATH
      ? method === 'GET'
        ? Response.json(liveBody)
        : put()
      : fakeFailure(400, 'unexpected'),
  );
  const exit = Effect.runPromiseExit(
    unifiOperations(spec)
      .reconcile(news, { olds, output: {} })
      .pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
  );
  return { fake, exit };
};

const tagOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (!Exit.isFailure(exit)) return 'Success';
  const error = Cause.squash(exit.cause) as { _tag?: string; message?: string };
  return error._tag ?? 'defect';
};
const puts = (fake: { seen: ReadonlyArray<{ method: string }> }) =>
  fake.seen.filter((s) => s.method === 'PUT');

describe('removable-field allowlist (omission would turn the block off)', () => {
  test.each([
    ['ipv4Configuration', 'ipv4Configuration'],
    ['dhcpGuarding', 'dhcpGuarding'],
    ['a required key (name)', 'name'],
  ])('dropping %s => UnifiFieldNotRemovable, zero PUTs', async (_n, key) => {
    const { [key as 'name']: _gone, ...news } = { ...WITH_V6 } as NetworkProps;
    const { fake, exit } = run(live({ ipv6Configuration: IPV6 }), news as NetworkProps, WITH_V6);
    const result = await exit;
    expect(tagOf(result)).toBe('UnifiFieldNotRemovable');
    expect(JSON.stringify(result)).toContain(key);
    expect(puts(fake)).toHaveLength(0);
  });

  // ⚠️ Mutation gap: an explicit `null` removes a key just like absence (`== null`, not `=== undefined`).
  test('an explicit null on ipv6Configuration removes it from the body', async () => {
    const news = { ...BASE, ipv6Configuration: null } as unknown as NetworkProps;
    const { fake, exit } = run(live({ ipv6Configuration: IPV6 }), news, WITH_V6, () =>
      Response.json(live()),
    );
    expect(tagOf(await exit)).toBe('Success');
    const body = puts(fake)[0] as { body?: Record<string, unknown> };
    expect(body.body).toBeDefined();
    expect('ipv6Configuration' in (body.body as object)).toBe(false);
  });
});

describe('write scope', () => {
  test('a live default (management) network is refused, zero PUTs', async () => {
    const { fake, exit } = run(live({ default: true }), WITH_V6, BASE);
    expect(tagOf(await exit)).toBe('UnifiManagementNetworkRefused');
    expect(puts(fake)).toHaveLength(0);
  });

  test.each([
    ['zoneId', { zoneId: 'zone-2' }, { zoneId: 'zone-1' }],
    ['vlanId', { vlanId: 17 }, {}],
    ['management', { management: 'GATEWAY' }, {}],
    ['deviceId', { deviceId: 'dev-2' }, { deviceId: 'dev-1' }],
  ])('a patch that changes %s is refused, zero PUTs', async (field, change, olds) => {
    const oldProps = { ...WITH_V6, ...olds } as NetworkProps;
    const { fake, exit } = run(
      live({ ipv6Configuration: IPV6, ...olds }),
      { ...oldProps, ...change } as NetworkProps,
      oldProps,
    );
    const result = await exit;
    expect(tagOf(result)).toBe('UnifiImmutableFieldChanged');
    expect(JSON.stringify(result)).toContain(field);
    expect(puts(fake)).toHaveLength(0);
  });

  test('olds naming another network id => UnifiIdentityChanged, zero PUTs', async () => {
    const { fake, exit } = run(live(), WITH_V6, { ...BASE, networkId: 'net-OLD' });
    expect(tagOf(await exit)).toBe('UnifiIdentityChanged');
    expect(puts(fake)).toHaveLength(0);
  });

  test('olds naming another site id => UnifiIdentityChanged, zero PUTs', async () => {
    const { fake, exit } = run(live(), WITH_V6, { ...BASE, siteId: 'site-OLD' });
    expect(tagOf(await exit)).toBe('UnifiIdentityChanged');
    expect(puts(fake)).toHaveLength(0);
  });
});

describe('the PUT is attempted once', () => {
  test('a 503 on the PUT is not retried', async () => {
    const { fake, exit } = run(live(), WITH_V6, BASE, () => fakeFailure(503, 'busy'));
    expect((await exit)._tag).toBe('Failure');
    expect(puts(fake)).toHaveLength(1);
  });
});

describe('error wording', () => {
  test('did-not-converge says the PUT landed and names re-import', () => {
    const message = new UnifiUpdateDidNotConverge({
      type: 'Unifi.Network',
      identity: 'sites/s/networks/n',
      fields: ['ipv6Configuration'],
    }).message;
    expect(message).toContain('LANDED');
    expect(message).toContain('differs from the declaration');
    expect(message).toContain('re-import');
    expect(message).toContain('[ipv6Configuration]');
  });

  test('live-drifted names both causes, not only a hand edit', () => {
    const message = new UnifiLiveDriftedSinceDeploy({
      type: 'Unifi.Network',
      identity: 'sites/s/networks/n',
      fields: ['name'],
    }).message;
    expect(message).toContain('hand edit');
    expect(message).toContain('UnifiUpdateDidNotConverge');
  });
});
