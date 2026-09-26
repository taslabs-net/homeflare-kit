/**
 * `Proxmox.StorageDownload` engine tests over a stub fetch. No live host, no live cluster.
 * ⚠️ The exact `import/` volid segment is REASONED, not measured — see storage-download-props.ts.
 *   These fixtures spell it that way for readability only; `readDownload` matches by filename
 *   suffix, so the tests below would pass with any segment spelling PVE actually uses.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, type FakePve, fakePve, withoutBao } from './fake-pve.ts';
import type { StorageDownloadProps } from './storage-download-props.ts';
import { ProxmoxStorageDownload, ProxmoxStorageDownloadProvider } from './storage-download.ts';

const NODE = 'pve1';
const STORAGE = 'cephfs-tb4';
const FILENAME = 'talos-v1.13.0-metal-amd64.qcow2';
const UPID = `UPID:${NODE}:00000002:0:0:imgdownload:${STORAGE}:test@pve!fake:`;
const row = (over: Partial<Record<string, unknown>> = {}) => ({
  format: 'qcow2',
  size: 123_456,
  volid: `${STORAGE}:import/${FILENAME}`,
  ...over,
});

const declare = (over: Partial<StorageDownloadProps> = {}): StorageDownloadProps => ({
  checksum: 'a'.repeat(64),
  checksumAlgorithm: 'sha256',
  filename: FILENAME,
  node: NODE,
  storage: STORAGE,
  target: FAKE_TARGET,
  url: 'https://images.example.test/talos.qcow2',
  ...over,
});

const engine = (fake: FakePve) =>
  engineOver(ProxmoxStorageDownloadProvider().pipe(Layer.provideMerge(fake.layer)));

const isTaskStatus = (call: { method: string; path: string }) =>
  call.path.includes('/tasks/') && call.path.endsWith('/status');
const isList = (call: { method: string; path: string }) =>
  call.method === 'GET' && call.path.includes('/content?');
const isDownload = (call: { method: string; path: string }) =>
  call.method === 'POST' && call.path.endsWith('/download-url');

describe('creating a download', () => {
  test('one POST to download-url, a task wait, then the next plan is noop', async () => {
    let downloaded = false;
    const fake = fakePve((call) => {
      if (isTaskStatus(call)) return { status: 'stopped', exitstatus: 'OK' };
      if (isList(call)) return downloaded ? [row()] : [];
      if (isDownload(call)) {
        downloaded = true;
        return UPID;
      }
      return null;
    });
    await withoutBao(async () => {
      const stack = engine(fake);
      expect(await stack.deploy(ProxmoxStorageDownload('image', declare()))).toEqual({
        image: 'create',
      });
      expect(
        (await stack.verify(ProxmoxStorageDownload('image', declare()), { all: true })).rows[0],
      ).toMatchObject({ diff: 'noop' });
    });
    expect(fake.writes()).toEqual([`POST nodes/${NODE}/storage/${STORAGE}/download-url`]);
    const posted = fake.calls.find((call) => call.method === 'POST')?.form;
    expect(posted?.['checksum']).toBe('a'.repeat(64));
    expect(posted?.['checksum-algorithm']).toBe('sha256');
    expect(posted?.['content']).toBe('import');
    expect(fake.calls.some((call) => call.path.includes('/tasks/'))).toBe(true);
  });

  test('⛔ checksum is required: an empty one is refused before any write ("checksum-pinned")', async () => {
    const fake = fakePve((call) => (isList(call) ? [] : null));
    await withoutBao(async () => {
      await expect(
        engine(fake).deploy(ProxmoxStorageDownload('image', declare({ checksum: '  ' }))),
      ).rejects.toThrow(/checksum is required/);
    });
    expect(fake.writes()).toEqual([]);
  });

  test('a failed download task refuses the plan — the checksum-mismatch refusal', async () => {
    const fake = fakePve((call) => {
      if (isTaskStatus(call)) return { exitstatus: 'checksum mismatch', status: 'stopped' };
      if (isList(call)) return [];
      if (isDownload(call)) return UPID;
      return null;
    });
    await withoutBao(async () => {
      await expect(engine(fake).deploy(ProxmoxStorageDownload('image', declare()))).rejects.toThrow(
        /checksum mismatch/,
      );
    });
  });
});

describe('removing a download', () => {
  test('not retain by default: dropping the declaration deletes the file and waits for its task', async () => {
    let exists = false;
    const fake = fakePve((call) => {
      if (isTaskStatus(call)) return { status: 'stopped', exitstatus: 'OK' };
      if (isList(call)) return exists ? [row()] : [];
      if (isDownload(call)) {
        exists = true;
        return UPID;
      }
      if (call.method === 'DELETE') {
        exists = false;
        return UPID;
      }
      return null;
    });
    await withoutBao(async () => {
      const stack = engine(fake);
      await stack.deploy(ProxmoxStorageDownload('image', declare()));
      await stack.deploy(Effect.void);
    });
    expect(fake.writes()).toHaveLength(2);
    expect(fake.writes()[0]).toBe(`POST nodes/${NODE}/storage/${STORAGE}/download-url`);
    expect(fake.writes()[1]).toMatch(
      new RegExp(`^DELETE nodes/${NODE}/storage/${STORAGE}/content/`),
    );
  });

  test('⛔ idempotent delete: a volume already gone by removal time sends no DELETE', async () => {
    let created = false;
    let vanished = false;
    const fake = fakePve((call) => {
      if (isTaskStatus(call)) return { status: 'stopped', exitstatus: 'OK' };
      if (isList(call)) return created && !vanished ? [row()] : [];
      if (isDownload(call)) {
        created = true;
        return UPID;
      }
      return null; // a DELETE here would fail the test below by never answering it
    });
    await withoutBao(async () => {
      const stack = engine(fake);
      await stack.deploy(ProxmoxStorageDownload('image', declare()));
      vanished = true; // out-of-band: something else already removed the file
      await stack.deploy(Effect.void);
    });
    expect(fake.writes()).toEqual([`POST nodes/${NODE}/storage/${STORAGE}/download-url`]);
  });
});

describe('no secret prop', () => {
  test('every declared field is a public identity or download parameter, never a credential', () => {
    for (const key of Object.keys(declare())) {
      expect(key).not.toMatch(/pass|secret|token|key$|credential/i);
    }
  });
});
