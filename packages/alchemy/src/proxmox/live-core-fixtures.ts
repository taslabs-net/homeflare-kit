/** Test-only declarations and vendor-shaped responses for the three migrated PVE families. */
import type * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { type FakeEngine, engineOver } from '../verify/fake-engine.ts';
import { ProxmoxBackupJob, ProxmoxBackupJobProvider } from './backup-job.ts';
import { deleteBackupJob, readBackupJob } from './backup-job-distilled.ts';
import { FAKE_TARGET, type FakePve } from './fake-pve.ts';
import { ProxmoxMetricServer, ProxmoxMetricServerProvider } from './metric-server.ts';
import { deleteMetricServer, readMetricServer } from './metric-server-distilled.ts';
import { ProxmoxPool, ProxmoxPoolProvider, deletePool, readPool } from './pool.ts';

export const poolProps = { poolid: 'lab', comment: 'managed', target: FAKE_TARGET };
export const backupProps = {
  id: 'nightly',
  schedule: '02:00',
  vmid: [103, 101],
  'prune-backups': 'keep-weekly=4,keep-daily=7',
  target: FAKE_TARGET,
};
export const metricProps = {
  id: 'metrics',
  type: 'influxdb' as const,
  server: 'metrics.test',
  port: 8086,
  target: FAKE_TARGET,
};

export interface CoreCase {
  name: string;
  path: string;
  declare: () => Effect.Effect<unknown, never, unknown>;
  engine: (fake: FakePve) => FakeEngine;
  read: () => Effect.Effect<unknown, unknown, HttpClient.HttpClient>;
  remove: () => Effect.Effect<unknown, unknown, HttpClient.HttpClient>;
  live: Record<string, unknown>;
  drift: Record<string, unknown>;
  missing: () => Response;
  createPath: string;
  /** Actual form fields, including defaults, without SDK identifier spelling leaking onto wire. */
  createForm: Record<string, string>;
}
export const coreCases: CoreCase[] = [
  {
    name: 'Pool',
    path: 'pools/lab',
    createPath: 'pools',
    declare: () => ProxmoxPool('row', poolProps),
    engine: (fake) => engineOver(ProxmoxPoolProvider().pipe(Layer.provideMerge(fake.layer))),
    read: () => readPool(poolProps),
    remove: () => deletePool(poolProps),
    live: { comment: 'managed', members: [] },
    drift: { comment: 'old', members: [] },
    missing: () =>
      Response.json({ message: "pool 'lab' does not exist\n", data: null }, { status: 500 }),
    createForm: { poolid: 'lab', comment: 'managed' },
  },
  {
    name: 'BackupJob',
    path: 'cluster/backup/nightly',
    createPath: 'cluster/backup',
    declare: () => ProxmoxBackupJob('row', backupProps),
    engine: (fake) => engineOver(ProxmoxBackupJobProvider().pipe(Layer.provideMerge(fake.layer))),
    read: () => readBackupJob(backupProps),
    remove: () => deleteBackupJob(backupProps),
    live: {
      id: 'nightly',
      schedule: '02:00',
      vmid: '101,103',
      'next-run': 987654,
      'prune-backups': { 'keep-daily': 7, 'keep-weekly': 4 },
      compress: 'zstd',
      mailto: 'operator.invalid',
    },
    drift: {
      id: 'nightly',
      schedule: '03:00',
      vmid: '101,103',
      'prune-backups': { 'keep-daily': 7, 'keep-weekly': 4 },
    },
    missing: () =>
      Response.json(
        {
          message: 'Parameter verification failed.\n',
          errors: { id: "No such job 'nightly'" },
          data: null,
        },
        { status: 400 },
      ),
    createForm: {
      id: 'nightly',
      schedule: '02:00',
      vmid: '101,103',
      all: '0',
      enabled: '1',
      mode: 'snapshot',
      'notification-mode': 'auto',
      'repeat-missed': '0',
      'prune-backups': 'keep-weekly=4,keep-daily=7',
    },
  },
  {
    name: 'MetricServer',
    path: 'cluster/metrics/server/metrics',
    createPath: 'cluster/metrics/server/metrics',
    declare: () => ProxmoxMetricServer('row', metricProps),
    engine: (fake) =>
      engineOver(ProxmoxMetricServerProvider().pipe(Layer.provideMerge(fake.layer))),
    read: () => readMetricServer(metricProps),
    remove: () => deleteMetricServer(metricProps),
    live: { type: 'influxdb', server: 'metrics.test', port: 8086, token: 'fake-not-a-secret' },
    drift: { type: 'influxdb', server: 'old.test', port: 8086, token: 'fake-not-a-secret' },
    missing: () =>
      Response.json(
        { message: "status server entry 'metrics' does not exist\n", data: null },
        { status: 500 },
      ),
    createForm: {
      type: 'influxdb',
      server: 'metrics.test',
      port: '8086',
      disable: '0',
      'verify-certificate': '1',
    },
  },
];
