/**
 * Public barrel: control-plane Resource constructors, not guests or NIC apply.
 *
 * ⛔ Lxc/Vm stay Provider-only. A Resource export would let a stack declare
 *   guests before storage/SDN exist. NodeNetwork/NetworkApply stay off the
 *   barrel for the same reason — they stage interfaces.new.
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

test('guests and NIC apply stay Provider-only', () => {
  expect(src).not.toMatch(/export \{ ProxmoxLxc[, }]/);
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
