/** Source-backed vendor responses; no live host or credential is used by these tests. */
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET } from './fake-pve.ts';
import type { CoreCase } from './live-core-fixtures.ts';
import { ProxmoxReplicationJob, ProxmoxReplicationJobProvider } from './replication-job.ts';
import { deleteReplicationJob, readReplicationJob } from './replication-job-lifecycle.ts';
import { ProxmoxFirewallAlias, ProxmoxFirewallAliasProvider } from './firewall-alias.ts';
import { deleteFirewallAlias, readFirewallAlias } from './firewall-alias-lifecycle.ts';

export const replicationProps = { target: FAKE_TARGET, guest: 900, jobnum: 0, targetNode: 'pve-b' };
export const aliasProps = {
  target: FAKE_TARGET,
  name: 'HomeLan',
  cidr: '192.0.2.1/32',
  comment: ' 0 ',
};
export const replicationLive = {
  id: '900-0',
  guest: 900,
  jobnum: 0,
  target: 'pve-b',
  type: 'local',
  source: 'pve-a',
};
export const aliasLive = { name: 'homelan', cidr: '192.0.2.1', ipversion: 4 };
export const replicationMissing = () =>
  Response.json({ data: null, message: "no such replication job '900-0'\n" }, { status: 500 });
export const aliasMissing = () =>
  Response.json(
    { data: null, message: 'Parameter verification failed.\n', errors: { name: 'no such alias' } },
    { status: 400 },
  );

export const replicationFirewallCases: CoreCase[] = [
  {
    name: 'ReplicationJob',
    path: 'cluster/replication/900-0',
    createPath: 'cluster/replication',
    declare: () => ProxmoxReplicationJob('row', replicationProps),
    engine: (fake) =>
      engineOver(ProxmoxReplicationJobProvider().pipe(Layer.provideMerge(fake.layer))),
    read: () => readReplicationJob(replicationProps),
    remove: () => deleteReplicationJob(replicationProps),
    live: replicationLive,
    drift: { ...replicationLive, remove_job: 'full' },
    missing: replicationMissing,
    createForm: {
      id: '900-0',
      type: 'local',
      target: 'pve-b',
      comment: '',
      disable: '0',
      schedule: '*/15',
    },
  },
  {
    name: 'FirewallAlias',
    path: 'cluster/firewall/aliases/HomeLan',
    createPath: 'cluster/firewall/aliases',
    declare: () => ProxmoxFirewallAlias('row', aliasProps),
    engine: (fake) =>
      engineOver(ProxmoxFirewallAliasProvider().pipe(Layer.provideMerge(fake.layer))),
    read: () => readFirewallAlias(aliasProps),
    remove: () => deleteFirewallAlias(aliasProps),
    live: aliasLive,
    drift: { ...aliasLive, comment: 'old' },
    missing: aliasMissing,
    createForm: { name: 'HomeLan', cidr: '192.0.2.1' },
  },
];
