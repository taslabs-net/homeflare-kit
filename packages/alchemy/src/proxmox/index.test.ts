/**
 * Public barrel: control-plane Resource constructors and `ProxmoxLxc`, not NIC apply.
 *
 * ⛔ NodeNetwork/NetworkApply stay off the barrel — they stage interfaces.new. ★ Lxc is a
 *   Resource since 2026-09-21: adopt-first, refuse-not-replace, retain on destroy (lxc.ts).
 * ★ CephDaemon, CephFs and CephOsd are Resources since 2026-09-22: adopt-only by shape and retain
 *   on destroy (ceph-adopt.test.ts). ⛔ CephFlag stays Provider-only: a declared flag reasserts a
 *   maintenance toggle on every deploy (ceph-flag.ts).
 * ★ ApiToken and ZfsPool are Resources since 2026-09-23, decision 9: ApiToken metadata-only,
 *   ZfsPool adopt-only when `devices`/`raidlevel` are left undeclared (api-token-adopt.test.ts,
 *   zfs-pool-adopt.test.ts).
 * ★ Vm and StorageDownload are Resources since 2026-09-26, for Talos: Vm's declared-keys model
 *   (qemu-props.ts) and retain-by-default; StorageDownload's checksum-pinned, create-oriented
 *   `download-url` (storage-download.ts). Neither was Provider-only for a design reason that
 *   changed — Vm's old "5-default PUT" is what kept it off this barrel until qemu-props.ts fixed
 *   it, per qemu-lifecycle.test.ts's own regression test.
 */
import { expect, test } from 'bun:test';
import { PbsDatastore, ProxmoxStorage } from './index.ts';

const src = await Bun.file(new URL('./index.ts', import.meta.url)).text();

const resourceExports = [
  'PbsDatastore',
  'PbsNotificationMatcher',
  'PbsNotificationTarget',
  'PbsPruneJob',
  'PbsSyncJob',
  'PbsVerifyJob',
  'ProxmoxAcl',
  'ProxmoxApiToken',
  'ProxmoxBackupJob',
  'ProxmoxCephDaemon',
  'ProxmoxCephFs',
  'ProxmoxCephOsd',
  'ProxmoxGroup',
  'ProxmoxHaResource',
  'ProxmoxHaRule',
  'ProxmoxLxc',
  'ProxmoxMetricServer',
  'ProxmoxNotificationMatcher',
  'ProxmoxNotificationTarget',
  'ProxmoxRole',
  'ProxmoxSdnApply',
  'ProxmoxSdnSubnet',
  'ProxmoxSdnVnet',
  'ProxmoxSdnZone',
  'ProxmoxStorage',
  'ProxmoxStorageDownload',
  'ProxmoxUser',
  'ProxmoxVm',
  'ProxmoxZfsPool',
] as const;

test('control-plane Resource constructors are on the public barrel', () => {
  expect(ProxmoxStorage).toBeDefined();
  expect(PbsDatastore).toBeDefined();
  for (const name of resourceExports) {
    expect(src).toContain(`${name},`);
  }
});

test('the provisioning baseline is on the barrel: the list, the declaration, the bootstrap', async () => {
  const barrel = await import('./index.ts');
  expect(barrel.PROVISION_PRIVILEGES).toHaveLength(27);
  expect(typeof barrel.declareProvisionBaseline).toBe('function');
  expect(barrel.provisionBootstrap()).toStartWith('#!/bin/sh\n');
});

test('NIC apply and the Ceph flag stay Provider-only', () => {
  expect(src).not.toMatch(/export \{ ProxmoxNodeNetwork[, }]/);
  expect(src).not.toMatch(/export \{ ProxmoxNetworkApply[, }]/);
  expect(src).not.toMatch(/export \{ ProxmoxCephFlag[, }]/);
});
