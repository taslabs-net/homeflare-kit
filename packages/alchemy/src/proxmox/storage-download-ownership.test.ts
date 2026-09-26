/**
 * Whose file it is — docs/ownership.md applied to `Proxmox.StorageDownload` (red-team C2 on PR
 * 297), through the real engine over a stub fetch (fake-pve.ts).
 *
 * ⛔ WHAT THIS PINS: a pre-existing file at the declared filename, that this stack holds no state
 *   for, is never adopted silently. The measured regression was worse than a pointless write-back:
 *   this family is not retain-by-default, so a silent adoption followed by dropping the declaration
 *   later DELETES a file this stack never created. `adopt(false)` wins over the test harness's own
 *   forced `AdoptPolicy: true` (fake-engine.ts), same as qemu-ownership.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { adopt } from 'alchemy/AdoptPolicy';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, fakePve, withoutBao } from './fake-pve.ts';
import type { StorageDownloadProps } from './storage-download-props.ts';
import { ProxmoxStorageDownload, ProxmoxStorageDownloadProvider } from './storage-download.ts';

const NODE = 'pve1';
const STORAGE = 'cephfs-tb4';
const FILENAME = 'talos-v1.13.0-metal-amd64.qcow2';
const row = { format: 'qcow2', size: 1, volid: `${STORAGE}:import/${FILENAME}` };
const declare = (): StorageDownloadProps => ({
  checksum: 'a'.repeat(64),
  checksumAlgorithm: 'sha256',
  filename: FILENAME,
  node: NODE,
  storage: STORAGE,
  target: FAKE_TARGET,
  url: 'https://images.example.test/talos.qcow2',
});

const isList = (call: { method: string; path: string }) =>
  call.method === 'GET' && call.path.includes('/content?');

const engine = (fake: ReturnType<typeof fakePve>) =>
  engineOver(ProxmoxStorageDownloadProvider().pipe(Layer.provideMerge(fake.layer)));

describe('Proxmox.StorageDownload ownership', () => {
  test('adopt(false): a pre-existing file is refused, and nothing is downloaded or deleted', async () => {
    const fake = fakePve((call) => (isList(call) ? [row] : null));
    await withoutBao(async () => {
      const declared = ProxmoxStorageDownload('image', declare()).pipe(adopt(false));
      await expect(engine(fake).deploy(declared)).rejects.toThrow(
        /adopt|exists, and this stack holds no state/i,
      );
    });
    expect(fake.writes()).toEqual([]);
  });
});
