/**
 * ONE PATH, ONE DECLARATION (binary.ts `claim`), through Alchemy's own Plan and Apply over the real
 * localRunner in a fresh temp directory (fake-engine.ts).
 *
 * 🔴 MEASURED 2026-09-22 BEFORE THE FIX: `vmalert` and `vmalert-logs` declared at one path both
 *   planned `create` and both succeeded; the next deploy, without `vmalert-logs`, planned
 *   `vmalert: noop, vmalert-logs: delete` — and the file `vmalert` still declared was gone.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VMALERT_TEXT, realEngine } from './fake-engine.ts';
import { VMUTILS_URL } from './fake-release.ts';

let dir = '';
beforeEach(async () => {
  dir = join(await mkdtemp(join(tmpdir(), 'hf-claims-')), 'vmutils-1.151.0');
  await mkdir(dir);
});
afterEach(async () => {
  await rm(join(dir, '..'), { force: true, recursive: true });
});

const onDisk = () =>
  Bun.file(join(dir, 'vmalert'))
    .text()
    .catch(() => undefined);

test('⛔ a second resource at the same path is refused in the deploy that declares it', async () => {
  const e = realEngine();
  await expect(e.deploy({ vmalert: dir, 'vmalert-logs': dir })).rejects.toThrow(
    'is already installed by',
  );
  // One of the two installed it; the other touched nothing.
  expect(await onDisk()).toBe(VMALERT_TEXT);
  expect(e.gets).toEqual([VMUTILS_URL]);
});

test('declared once, the survivor keeps its file when the stack is corrected', async () => {
  const e = realEngine();
  await e.deploy({ vmalert: dir, 'vmalert-logs': dir }).catch(() => undefined);
  // ★ MEASURED: the first declared won the claim. The refused one left only the engine's
  //   unfinished-create row, whose delete touches no file — so the survivor keeps its binary.
  expect(await e.deploy({ vmalert: dir })).toEqual({ vmalert: 'noop', 'vmalert-logs': 'delete' });
  expect(await onDisk()).toBe(VMALERT_TEXT);
});
