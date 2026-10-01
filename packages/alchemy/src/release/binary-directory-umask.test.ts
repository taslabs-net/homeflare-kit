/**
 * THE FIXTURE DIRECTORIES DO NOT DEPEND ON THE UMASK (fake-engine.ts `makeBinaryDirectory`).
 *
 * 🔴 MEASURED 2026-10-01: under CT100's login umask 0002 six tests in binary-alias and
 *   binary-claims failed with "directory ... is writable by group or other (mode 0775)", because
 *   their fixtures made the directory with a bare `mkdir`; under 022 they passed. Only the
 *   fixtures were wrong — Release.Binary is right to refuse a directory its group may write, and
 *   the last test here pins that it still does, on the real filesystem.
 *
 * Each test sets the umask for itself and puts the process's own back in a `finally`; bun runs the
 * tests of a file one after another, so nothing else sees the changed mask. Every directory is
 * under a fresh `mkdtemp`, removed in `afterEach`.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VMALERT_TEXT, makeBinaryDirectory, realEngine } from './fake-engine.ts';

let tmp = '';
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hf-umask-'));
});
afterEach(async () => {
  await rm(tmp, { force: true, recursive: true });
});

/** Run `body` under `mask`, and give the process its own umask back whatever happens. */
const underUmask = async <T>(mask: number, body: () => Promise<T>): Promise<T> => {
  const before = process.umask(mask);
  try {
    return await body();
  } finally {
    process.umask(before);
  }
};
const modeOf = async (path: string): Promise<number> => (await stat(path)).mode & 0o777;
const octal = (mode: number): string => mode.toString(8).padStart(4, '0');

describe('makeBinaryDirectory', () => {
  for (const mask of [0o000, 0o002, 0o022]) {
    test(`makes 0755 directories under umask ${octal(mask)}, the leaf and the ones on the way`, async () => {
      const leaf = join(tmp, 'real', 'vmutils-1.151.0');
      await underUmask(mask, () => makeBinaryDirectory(leaf));
      expect(octal(await modeOf(leaf))).toBe('0755');
      expect(octal(await modeOf(join(tmp, 'real')))).toBe('0755');
    });
  }

  test('⛔ the control: a bare mkdir under 0002 is the 0775 the resource refuses, and still is', async () => {
    const dir = join(tmp, 'vmutils-1.151.0');
    await underUmask(0o002, () => mkdir(dir));
    expect(octal(await modeOf(dir))).toBe('0775');
    await expect(realEngine().deploy({ vmalert: dir })).rejects.toThrow(
      `directory ${dir} is writable by group or other (mode 0775)`,
    );
  });

  test('the real engine installs into one made under a group-writable umask', async () => {
    const dir = join(tmp, 'vmutils-1.151.0');
    await underUmask(0o002, () => makeBinaryDirectory(dir));
    expect(await realEngine().deploy({ vmalert: dir })).toEqual({ vmalert: 'create' });
    expect(await Bun.file(join(dir, 'vmalert')).text()).toBe(VMALERT_TEXT);
  });
});
