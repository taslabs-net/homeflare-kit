/**
 * Pure unit tests for `judgeIdentity` — red-team I1/I2 on PR 297. No network, no fake PVE.
 * ⛔ WHAT THESE PIN: a changed `filename`/`storage` is a `replace`, never a silent `update` that
 *   orphans the old file; a changed pin (`checksum`/`url`/…) on the SAME `filename` is named for a
 *   refusal, never treated as a matching declaration; nothing changing is `same`.
 */
import { describe, expect, test } from 'bun:test';
import { FAKE_TARGET } from './fake-pve.ts';
import { judgeIdentity } from './storage-download-identity.ts';
import type { StorageDownloadProps } from './storage-download-props.ts';

const base: StorageDownloadProps = {
  checksum: 'a'.repeat(64),
  checksumAlgorithm: 'sha256',
  filename: 'talos-v1.13.0-metal-amd64.qcow2',
  node: 'pve1',
  storage: 'cephfs-tb4',
  target: FAKE_TARGET,
  url: 'https://images.example.test/talos.qcow2',
};

describe('judgeIdentity', () => {
  test('no prior declaration: always "same" -- a fresh create has nothing to compare', () => {
    expect(judgeIdentity(base, undefined)).toEqual({ kind: 'same' });
  });

  test('nothing changed: "same"', () => {
    expect(judgeIdentity(base, { ...base })).toEqual({ kind: 'same' });
  });

  test('a changed filename is a "replace": the measured I1 regression (silent orphan)', () => {
    expect(judgeIdentity({ ...base, filename: 'talos-v1.14.0-metal-amd64.qcow2' }, base)).toEqual({
      kind: 'replace',
    });
  });

  test('a changed storage is a "replace" too', () => {
    expect(judgeIdentity({ ...base, storage: 'cephtb4' }, base)).toEqual({ kind: 'replace' });
  });

  test('a changed checksum on the same filename is "pin-changed": the measured I2 regression', () => {
    const verdict = judgeIdentity({ ...base, checksum: 'b'.repeat(64) }, base);
    expect(verdict.kind).toBe('pin-changed');
    expect((verdict as { refuse: string }).refuse).toMatch(/checksum changed but filename did not/);
  });

  test('a changed url on the same filename is "pin-changed" too', () => {
    const verdict = judgeIdentity(
      { ...base, url: 'https://images.example.test/other.qcow2' },
      base,
    );
    expect(verdict.kind).toBe('pin-changed');
  });
});
