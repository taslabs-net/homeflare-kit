/**
 * ONE FILE UNDER TWO SPELLINGS (launchd/file-identity.ts), on a REAL filesystem: localRunner in a
 * fresh temp directory, through Alchemy's own Plan and Apply where the engine's order matters.
 * Nothing outside `mkdtemp` is touched, and the release is synthetic (fake-release.ts).
 *
 * 🔴 EACH TEST BELOW FAILED BEFORE THE FIX (measured 2026-09-22): the respelled deploy planned a
 *   `replace`, reported success, and left no binary on disk; the next deploy put it back.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type HostRunner } from '../launchd/runner.ts';
import { localRunner } from '../launchd/local-runner.ts';
import { reconcileBinary } from './binary-lifecycle.ts';
import { VMALERT_TEXT, realEngine } from './fake-engine.ts';
import { VMUTILS_URL, fakeTransport, syntheticRelease, vmalertProps } from './fake-release.ts';

let tmp = '';
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hf-alias-'));
  await mkdir(join(tmp, 'real', 'vmutils-1.151.0'), { recursive: true });
  await symlink(join(tmp, 'real'), join(tmp, 'link'));
});
afterEach(async () => {
  await rm(tmp, { force: true, recursive: true });
});

const REAL = () => join(tmp, 'real', 'vmutils-1.151.0');
const LINKED = () => join(tmp, 'link', 'vmutils-1.151.0');
/** The installed binary's text, or undefined when the deploy lost it. */
const onDisk = () =>
  Bun.file(join(REAL(), 'vmalert'))
    .text()
    .catch(() => undefined);
const engine = () => {
  const e = realEngine();
  return { deploy: (directory: string) => e.deploy({ vmalert: directory }), gets: e.gets };
};

/** Whether this temp directory's volume folds case (APFS's default on macOS; not ext4). */
const foldsCase = async (): Promise<boolean> =>
  stat(join(tmp, 'REAL')).then(
    () => true,
    () => false,
  );

describe('a respelled directory is an update that keeps the file, never a replace', () => {
  test('through a symlinked parent, via the engine', async () => {
    const e = engine();
    expect(await e.deploy(REAL())).toEqual({ vmalert: 'create' });
    expect(await e.deploy(LINKED())).toEqual({ vmalert: 'update' });
    expect(await onDisk()).toBe(VMALERT_TEXT);
    expect(await e.deploy(LINKED())).toEqual({ vmalert: 'noop' });
    expect(e.gets).toEqual([VMUTILS_URL]);
  });

  test('by case alone, on a volume that folds case', async () => {
    if (!(await foldsCase())) return;
    const e = engine();
    await e.deploy(REAL());
    expect(await e.deploy(join(tmp, 'real', 'VMUTILS-1.151.0'))).toEqual({ vmalert: 'update' });
    expect(await onDisk()).toBe(VMALERT_TEXT);
  });

  test('an update across the respelling (the path unresolved at plan) keeps the file', async () => {
    const { catalog, vmutils } = syntheticRelease();
    const fetch = fakeTransport({ [VMUTILS_URL]: vmutils }).fetch;
    const olds = vmalertProps(catalog, { directory: REAL() });
    const output = await reconcileBinary(localRunner(), fetch, olds);
    const news = vmalertProps(catalog, { directory: LINKED() });
    const after = await reconcileBinary(localRunner(), fetch, news, { olds, output });
    expect(after.path).toBe(join(LINKED(), 'vmalert'));
    expect(await onDisk()).toBe(VMALERT_TEXT);
  });

  test('⛔ other bytes at the respelled path are still refused, never written in place', async () => {
    const { catalog, vmutils } = syntheticRelease();
    const transport = fakeTransport({ [VMUTILS_URL]: vmutils });
    const olds = vmalertProps(catalog, { directory: REAL() });
    const output = await reconcileBinary(localRunner(), transport.fetch, olds);
    const news = vmalertProps(catalog, { directory: LINKED(), sha256: 'e'.repeat(64) });
    await expect(
      reconcileBinary(localRunner(), transport.fetch, news, { olds, output }),
    ).rejects.toThrow('already exists and is not this resource');
    expect(await onDisk()).toBe(VMALERT_TEXT);
  });

  test('⚠️ a runner that reports no identity: the loss fails the deploy instead of passing', async () => {
    const real = localRunner();
    const blind: HostRunner = {
      ...real,
      stat: async (path) => {
        const found = await real.stat(path);
        if (found === undefined) return undefined;
        const { dev: _dev, ino: _ino, ...rest } = found;
        return rest;
      },
    };
    const { catalog, vmutils } = syntheticRelease();
    const fetch = fakeTransport({ [VMUTILS_URL]: vmutils }).fetch;
    const olds = vmalertProps(catalog, { directory: REAL() });
    const output = await reconcileBinary(blind, fetch, olds);
    const news = vmalertProps(catalog, { directory: LINKED() });
    await expect(reconcileBinary(blind, fetch, news, { olds, output })).rejects.toThrow(
      'they are one file under two spellings',
    );
  });
});
