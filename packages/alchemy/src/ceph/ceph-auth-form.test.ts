/**
 * The pure props/state comparison `diff` runs — no ssh, no fake dial, nothing async. Mon-transport
 * doc: "a plan never elevates"; this is the whole of what a plan may ever decide for this family.
 */
import { describe, expect, test } from 'bun:test';
import {
  type CephAuthEntityAttributes,
  attributesOf,
  capsEqual,
  cephCliPath,
  cephDataPath,
  planCephAuthEntity,
} from './ceph-auth-form.ts';

const CAPS = {
  mgr: 'profile rbd pool=k8s-rbd',
  mon: 'profile rbd',
  osd: 'profile rbd pool=k8s-rbd',
};
const OTHER = { ...CAPS, osd: 'profile rbd pool=other' };
const OUTPUT: CephAuthEntityAttributes = {
  baoPath: 'talos-c1/ceph/client.k8s-rbd',
  caps: CAPS,
  entity: 'client.k8s-rbd',
  fingerprint: 'deadbeef',
  node: 'mon-a.example.test',
};
const PROPS = {
  caps: CAPS,
  entity: 'client.k8s-rbd',
  mount: 'talos-c1',
  nodes: ['mon-a.example.test'],
};

describe('planCephAuthEntity', () => {
  test('a brand-new row (no output) leaves the decision to reconcile', () => {
    expect(planCephAuthEntity(PROPS, undefined)).toBeUndefined();
  });

  test('caps unchanged plans noop', () => {
    expect(planCephAuthEntity(PROPS, OUTPUT)).toEqual({ action: 'noop' });
  });

  test('caps changed plans update', () => {
    expect(planCephAuthEntity({ ...PROPS, caps: OTHER }, OUTPUT)).toEqual({ action: 'update' });
  });
});

describe('capsEqual', () => {
  test('true for the same three fields, false if any one differs', () => {
    expect(capsEqual(CAPS, { ...CAPS })).toBe(true);
    expect(capsEqual(CAPS, { ...CAPS, mon: 'profile rbd pool=other' })).toBe(false);
    expect(capsEqual(CAPS, { ...CAPS, osd: 'profile rbd pool=other' })).toBe(false);
    expect(capsEqual(CAPS, { ...CAPS, mgr: 'profile rbd pool=other' })).toBe(false);
  });
});

describe('bao paths', () => {
  test('the CLI-style path has no `data/` segment; the HTTP path does', () => {
    expect(cephCliPath('talos-c1', 'client.k8s-rbd')).toBe('talos-c1/ceph/client.k8s-rbd');
    expect(cephDataPath('talos-c1', 'client.k8s-rbd')).toBe('talos-c1/data/ceph/client.k8s-rbd');
  });

  test('a trailing slash on the mount is trimmed', () => {
    expect(cephCliPath('talos-c1/', 'client.k8s-rbd')).toBe('talos-c1/ceph/client.k8s-rbd');
  });
});

describe('attributesOf', () => {
  test('carries the fingerprint given, never anything shaped like a key', () => {
    const attrs = attributesOf(PROPS, 'deadbeef', 'mon-a.example.test');
    expect(attrs).toEqual(OUTPUT);
    expect(Object.keys(attrs)).not.toContain('key');
  });
});
