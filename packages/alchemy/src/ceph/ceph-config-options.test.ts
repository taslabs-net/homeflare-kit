/**
 * Structural guard on the named config-option list itself (mon-transport doc acceptance test #3):
 * the list contains none of the lockout classes, and it starts empty (D-C1).
 */
import { describe, expect, test } from 'bun:test';
import { NAMED_CONFIG_OPTIONS, isLockoutConfigOption } from './ceph-config-options.ts';

describe('NAMED_CONFIG_OPTIONS', () => {
  test('starts empty', () => {
    expect(NAMED_CONFIG_OPTIONS.size).toBe(0);
  });

  test('contains none of the lockout classes, whatever gets added later', () => {
    const bad = [...NAMED_CONFIG_OPTIONS].filter((name) => isLockoutConfigOption(name));
    expect(bad).toEqual([]);
  });
});

describe('isLockoutConfigOption', () => {
  test.each([
    'mon_host',
    'public_network',
    'cluster_network',
    'public_addr',
    'cluster_addr',
    'auth_cluster_required',
    'auth_service_required',
    'auth_client_required',
    'keyring',
    'mgr_keyring',
    'keyring_path',
    'key',
    'mon_data_key',
  ])('flags %s', (name) => {
    expect(isLockoutConfigOption(name)).toBe(true);
  });

  test.each(['mon_allow_pool_delete', 'osd_pool_default_size', 'mon_max_pg_per_osd'])(
    'does not flag an ordinary tuning option like %s',
    (name) => {
      expect(isLockoutConfigOption(name)).toBe(false);
    },
  );
});
