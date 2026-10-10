/**
 * `Unifi.Network`'s three-way update against `fakeUnifi`, driving `unifiOperations(spec).reconcile`
 * with `olds`/`output` set. The PUT goes through the real SDK `updateNetwork`, so path assembly,
 * JSON encode and status→error matching are the production ones.
 *
 * ⚠️ These call `unifiOperations` directly, which bypasses the wire guard (see `wire-guard.test.ts`
 *   for that); here the question is WHICH BODY is sent and WHEN. The fake records every request.
 */
import { describe, expect, test } from 'bun:test';
import type * as networks from '@distilled.cloud/unifi-network/networks';
import * as Retry from '@distilled.cloud/unifi-network/Retry';
import * as Effect from 'effect/Effect';
import { fakeFailure, fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import { NETWORK_PATCH_KEYS, type NetworkProps, spec } from './network.ts';
import {
  UnifiLiveDriftedSinceDeploy,
  UnifiUpdateDidNotConverge,
  UnifiWriteRefused,
} from './policy.ts';
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

/** Raw live object, with a key the SDK schema has never heard of. */
const live = (extra: Record<string, unknown> = {}) => ({
  id: 'net-1',
  default: false,
  metadata: { origin: 'USER' },
  futureTopLevelKey: 'x',
  ...BASE,
  siteId: undefined,
  networkId: undefined,
  ...extra,
});

const reconcile = (
  route: (method: string, url: URL) => Response,
  news: NetworkProps,
  olds: NetworkProps | undefined,
  outputArg: object | null = {},
) => {
  const output = outputArg ?? undefined;
  const fake = fakeUnifi(route);
  const notes: string[] = [];
  const run = unifiOperations(spec)
    .reconcile(news, {
      olds,
      output,
      note: (m) => Effect.sync(() => void notes.push(m)),
    })
    .pipe(Retry.none, Effect.provide(fakeUnifiLayer(fake.fetch)));
  return { fake, notes, exit: Effect.runPromiseExit(run) };
};

const answering =
  (liveBody: object, put: () => Response = () => Response.json(liveBody)) =>
  (method: string, url: URL) =>
    url.pathname === PATH
      ? method === 'GET'
        ? Response.json(liveBody)
        : put()
      : fakeFailure(400, 'unexpected');

const putBody = (seen: ReadonlyArray<{ method: string; body?: unknown }>) =>
  seen.filter((s) => s.method === 'PUT').map((s) => s.body as Record<string, unknown>);

describe('Unifi.Network update', () => {
  test('(1) one GET then one PUT: live carried through byte-equal, server fields dropped, patch added', async () => {
    const liveBody = live();
    const after = { ...liveBody, ipv6Configuration: IPV6 };
    const route = answering(liveBody, () => Response.json(after));
    const { fake, exit, notes } = reconcile(route, WITH_V6, BASE);
    expect((await exit)._tag).toBe('Success');
    expect(fake.seen.map((s) => s.method)).toEqual(['GET', 'PUT']);
    const body = putBody(fake.seen)[0] as Record<string, unknown>;
    for (const k of ['id', 'default', 'metadata']) expect(k in body).toBe(false);
    expect(body.futureTopLevelKey).toBe('x');
    expect(body.dhcpGuarding).toEqual(liveBody.dhcpGuarding);
    expect(body.ipv4Configuration).toEqual(liveBody.ipv4Configuration);
    expect(body.ipv6Configuration).toEqual(IPV6);
    // (8) one note, field names only
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('changes [ipv6Configuration]');
    expect(notes[0]).not.toContain('2602');
  });

  test('(2) an unknown NESTED key in live ipv6Configuration survives into the body (F2 alarm)', async () => {
    const nested = { ...IPV6, futureNestedKey: 'keep' };
    const liveBody = live({ ipv6Configuration: nested });
    // olds mirrors live (as an import of the live object would), so there is no drift; news
    // changes only `name`.
    const olds = { ...BASE, ipv6Configuration: nested } as NetworkProps;
    const { fake, exit } = reconcile(answering(liveBody), { ...olds, name: 'Compute2' }, olds);
    await exit;
    const body = putBody(fake.seen)[0] as {
      ipv6Configuration: Record<string, unknown>;
      name: string;
    };
    expect(body.ipv6Configuration.futureNestedKey).toBe('keep');
    expect(body.name).toBe('Compute2');
  });

  test('(3) revert: olds has ipv6Configuration, news omits it => PUT body has no such key', async () => {
    const liveBody = live({ ipv6Configuration: IPV6 });
    const { fake, exit } = reconcile(
      answering(liveBody, () => Response.json(live())),
      BASE,
      WITH_V6,
    );
    expect((await exit)._tag).toBe('Success');
    const bodies = putBody(fake.seen);
    expect(bodies).toHaveLength(1);
    expect('ipv6Configuration' in (bodies[0] as object)).toBe(false);
  });

  test.each([401, 403])('(4) PUT %d => typed failure, exactly one PUT', async (status) => {
    const { fake, exit } = reconcile(
      answering(live(), () => fakeFailure(status, 'no')),
      WITH_V6,
      BASE,
    );
    const result = await exit;
    expect(result._tag).toBe('Failure');
    expect(fake.seen.map((s) => s.method)).toEqual(['GET', 'PUT']);
  });

  test('(5) PUT 200 whose body still mismatches => UnifiUpdateDidNotConverge', async () => {
    const { fake, exit } = reconcile(answering(live()), WITH_V6, BASE);
    const result = await exit;
    expect(JSON.stringify(result)).toContain('UnifiUpdateDidNotConverge');
    expect(fake.seen.filter((s) => s.method === 'PUT')).toHaveLength(1);
    expect(UnifiUpdateDidNotConverge.name).toBe('UnifiUpdateDidNotConverge');
  });

  test('(6) live drifted from olds on name => UnifiLiveDriftedSinceDeploy[name], zero PUTs', async () => {
    const { fake, exit } = reconcile(answering(live({ name: 'Renamed' })), WITH_V6, BASE);
    const result = await exit;
    expect(JSON.stringify(result)).toContain('UnifiLiveDriftedSinceDeploy');
    expect(JSON.stringify(result)).toContain('"fields":["name"]');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
    expect(UnifiLiveDriftedSinceDeploy.name).toBe('UnifiLiveDriftedSinceDeploy');
  });

  test.each([
    ['output undefined', BASE, null],
    ['olds undefined', undefined, {}],
  ])('(7) %s => refuses update, all-GET', async (_n, olds, output) => {
    const { fake, exit } = reconcile(answering(live()), WITH_V6, olds, output);
    const result = await exit;
    expect(JSON.stringify(result)).toContain('UnifiWriteRefused');
    expect(JSON.stringify(result)).toContain('"action":"update"');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
    expect(UnifiWriteRefused.name).toBe('UnifiWriteRefused');
  });

  test('declared change equal to olds (pure drift driftOf missed is impossible) writes nothing', async () => {
    // news == olds but live differs only in a field driftOf compares: that is drift, refused.
    const { fake, exit } = reconcile(answering(live({ vlanId: 99 })), BASE, BASE);
    expect((await exit)._tag).toBe('Failure');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('an exact match writes nothing even with olds/output set (H6)', async () => {
    const { fake, exit } = reconcile(answering(live()), BASE, BASE);
    expect((await exit)._tag).toBe('Success');
    expect(fake.seen.map((s) => s.method)).toEqual(['GET']);
  });
});

describe('NETWORK_PATCH_KEYS', () => {
  test('equals every NetworkProps key except the two ids', () => {
    const full: Required<NetworkProps> = {
      siteId: 's',
      networkId: 'n',
      name: 'x',
      enabled: true,
      management: 'm',
      vlanId: 2,
      dhcpGuarding: { trustedDhcpServerIpAddresses: [] },
      cellularBackupEnabled: true,
      internetAccessEnabled: true,
      ipv4Configuration: {},
      ipv6Configuration: {} as networks.NetworkIPv6Configuration,
      isolationEnabled: true,
      mdnsForwardingEnabled: true,
      zoneId: 'z',
      deviceId: 'd',
    };
    const ids = ['siteId', 'networkId'];
    const expected = Object.keys(full).filter((k) => !ids.includes(k));
    expect([...NETWORK_PATCH_KEYS].map(String).sort()).toEqual(expected.sort());
  });
});
