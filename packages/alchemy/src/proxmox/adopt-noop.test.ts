/**
 * Adopting an object that already matches must be read-only — measured per reconcile SHAPE, through
 * Alchemy's own Plan and Apply over a fake cluster (fake-pve.ts, ../verify/fake-engine.ts).
 *
 * ★ ONE ROW PER WAY A FAMILY REACHES ITS WRITE, not one per family. Every family built on
 *   `pveHandlers` shares resource.ts's reconcile, so `Proxmox.Pool` stands for all of them; `Acl`
 *   wraps that reconcile; `PbsDatastore` and `SdnApply` write their own. CephPool, the one that got
 *   it wrong, has its own file. docs/adopt-verify.md carries the full per-family table.
 * ⚠️ A FIXTURE THAT DOES NOT MATCH TURNS A ROW INTO A DRIFT TEST, and the assertion on the
 *   verifier's `noop` is what catches that: a wrong fixture fails loudly instead of passing for
 *   the wrong reason. The Pool drift row proves the harness can see a write at all.
 */
import { describe, expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { ProxmoxAcl, ProxmoxAclProvider } from './acl.ts';
import type { PbsTarget } from './credentials.ts';
import { FAKE_TARGET, fakePve, withoutBao } from './fake-pve.ts';
import { ProxmoxGroup, ProxmoxGroupProvider } from './group.ts';
import { PbsDatastore, PbsDatastoreProvider } from './pbs-datastore.ts';
import { ProxmoxPool, ProxmoxPoolProvider } from './pool.ts';
import { ProxmoxSdnApply, ProxmoxSdnApplyProvider } from './sdn-apply.ts';
import { ProxmoxUser, ProxmoxUserProvider } from './user.ts';

const PBS: PbsTarget = { api: 'https://pbs.test:8007/api2/json', mount: 'pbs-test', scheme: 'pbs' };

type Case = {
  readonly name: string;
  readonly provider: () => Layer.Layer<never, never, never>;
  readonly declare: () => ReturnType<typeof ProxmoxPool>;
  /** GET path → the `data` PVE/PBS answers; anything unlisted answers `null`. */
  readonly live: Readonly<Record<string, unknown>>;
};

const cases: readonly Case[] = [
  {
    declare: () => ProxmoxPool('lab', { comment: 'x', poolid: 'lab', target: FAKE_TARGET }),
    live: { 'pools/lab': { comment: 'x', members: [] } },
    name: 'Proxmox.Pool (pveHandlers: every factory family)',
    provider: ProxmoxPoolProvider as never,
  },
  {
    declare: () =>
      ProxmoxAcl('auditor', {
        path: '/',
        roleid: 'PVEAuditor',
        target: FAKE_TARGET,
        type: 'user',
        ugid: 'u@pve',
      }) as never,
    live: {
      'access/acl': [
        { path: '/', propagate: 1, roleid: 'PVEAuditor', type: 'user', ugid: 'u@pve' },
      ],
    },
    name: 'Proxmox.Acl (wraps the factory reconcile)',
    provider: ProxmoxAclProvider as never,
  },
  {
    declare: () =>
      ProxmoxGroup('mint', { comment: 'fence', groupid: 'hf-mint', target: FAKE_TARGET }) as never,
    live: { 'access/groups/hf-mint': { comment: 'fence', members: [] } },
    name: 'Proxmox.Group (its own reconcile, since the distilled migration)',
    provider: ProxmoxGroupProvider as never,
  },
  {
    // ⚠️ KEY IS PERCENT-ENCODED — user.ts's own ⚠️: distilled's `{userid}` substitution encodes
    //   the `@`, and `clusterWith` below does no decoding of `call.path`.
    declare: () =>
      ProxmoxUser('iac', { comment: 'x', target: FAKE_TARGET, userid: 'iac@pve' }) as never,
    live: { 'access/users/iac%40pve': { comment: 'x', enable: 1, expire: 0 } },
    name: 'Proxmox.User (its own reconcile, since the distilled migration)',
    provider: ProxmoxUserProvider as never,
  },
  {
    declare: () =>
      PbsDatastore('store1', {
        comment: 'c',
        'gc-schedule': 'daily',
        name: 'store1',
        path: '/mnt/store1',
        target: PBS,
      }) as never,
    live: {
      'config/datastore/store1': {
        comment: 'c',
        'gc-schedule': 'daily',
        name: 'store1',
        path: '/mnt/store1',
      },
    },
    name: 'Pbs.Datastore (its own reconcile)',
    provider: PbsDatastoreProvider as never,
  },
  {
    declare: () => ProxmoxSdnApply('sdn', { target: FAKE_TARGET }) as never,
    live: {},
    name: 'Proxmox.SdnApply (its own reconcile; nothing staged)',
    provider: ProxmoxSdnApplyProvider as never,
  },
];

const clusterWith = (live: Readonly<Record<string, unknown>>) =>
  fakePve((call) => (call.method === 'GET' ? live[call.path] : 'UPID:fake'));

describe('adopting a matching object only reads', () => {
  test.each(cases.map((c) => [c.name, c] as const))('%s', async (_, c) => {
    const fake = clusterWith(c.live);
    await withoutBao(async () => {
      const engine = engineOver(c.provider().pipe(Layer.provideMerge(fake.layer)));
      const report = await engine.verify(c.declare());
      expect(report.rows).toEqual([expect.objectContaining({ diff: 'noop', ok: true })]);
      expect(Object.values(await engine.deploy(c.declare()))).toEqual(['adopted']);
    });
    expect(fake.writes()).toEqual([]);
  });

  test('and the harness does see a write: a drifted Pool is PUT once', async () => {
    const fake = clusterWith({ 'pools/lab': { comment: 'old', members: [] } });
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxPoolProvider().pipe(Layer.provideMerge(fake.layer)));
      const declared = () =>
        ProxmoxPool('lab', { comment: 'x', poolid: 'lab', target: FAKE_TARGET });
      const report = await engine.verify(declared());
      expect(report.rows[0]).toMatchObject({ changed: ['comment'], diff: 'update', ok: false });
      expect(await engine.deploy(declared())).toEqual({ lab: 'adopted' });
    });
    expect(fake.writes()).toEqual(['PUT pools/lab']);
  });
});
