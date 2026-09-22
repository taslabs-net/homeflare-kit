/**
 * Public barrel: control-plane Resource constructors and `ProxmoxLxc`, not QEMU or NIC apply.
 *
 * ⛔ Vm stays Provider-only. NodeNetwork/NetworkApply stay off the barrel — they stage
 *   interfaces.new. ★ Lxc is a Resource since 2026-09-21: adopt-first, refuse-not-replace,
 *   retain on destroy (lxc.ts).
 */
import { expect, test } from 'bun:test';
import { PbsDatastore, ProxmoxStorage } from './index.ts';

const src = await Bun.file(new URL('./index.ts', import.meta.url)).text();

const resourceExports = [
  'PbsDatastore',
  'PbsPruneJob',
  'PbsSyncJob',
  'PbsVerifyJob',
  'ProxmoxAcl',
  'ProxmoxBackupJob',
  'ProxmoxGroup',
  'ProxmoxHaResource',
  'ProxmoxHaRule',
  'ProxmoxLxc',
  'ProxmoxMetricServer',
  'ProxmoxNotificationTarget',
  'ProxmoxRole',
  'ProxmoxSdnApply',
  'ProxmoxSdnSubnet',
  'ProxmoxSdnVnet',
  'ProxmoxSdnZone',
  'ProxmoxStorage',
  'ProxmoxUser',
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

test('QEMU and NIC apply stay Provider-only', () => {
  expect(src).not.toMatch(/export \{ ProxmoxVm[, }]/);
  expect(src).not.toMatch(/export \{ ProxmoxNodeNetwork[, }]/);
  expect(src).not.toMatch(/export \{ ProxmoxNetworkApply[, }]/);
  expect(src).not.toMatch(/export \{ ProxmoxApiToken[, }]/);
  expect(src).not.toMatch(/export \{ ProxmoxZfsPool[, }]/);
  expect(src).not.toMatch(/export \{ ProxmoxCephOsd[, }]/);
  expect(src).not.toMatch(/export \{ ProxmoxCephFs[, }]/);
  expect(src).not.toMatch(/export \{ ProxmoxCephDaemon[, }]/);
  expect(src).not.toMatch(/export \{ ProxmoxCephFlag[, }]/);
});
