/**
 * A FAILED FIRST INSTALL MUST NOT BRICK THE STAGE (binary-read.ts), through Alchemy's own Plan and
 * Apply. With `directory: dir.path`, the documented shape, Apply commits the `creating` row while
 * the directory is still an Output, so the row carries no `directory`; the next plan's recovery
 * read — and, once the declaration is gone, Apply's orphan delete — is asked with that row.
 *
 * 🔴 MEASURED 2026-09-22 against the code before binary-read.ts, every case below: the next deploy
 *   died with `TypeError: undefined is not an object (evaluating 'path.startsWith')`, the fixed
 *   declaration included, and removing the declaration failed with `DestroyError`.
 */
import { describe, expect, test } from 'bun:test';
import { BINARY, VMUTILS_URL } from './fake-release.ts';
import { DIR, PATH, deployHarness } from './fake-deploy.ts';

describe('after a failed first install', () => {
  test('a download that failed: the next deploy installs, then is a noop', async () => {
    const h = deployHarness(false);
    h.server.serving = false;
    await expect(h.stack.deploy(h.wired())).rejects.toThrow('HTTP 404');
    h.server.serving = true;
    h.events.length = 0;
    expect(await h.stack.deploy(h.wired())).toEqual({ dir: 'noop', vmalert: 'create' });
    expect(h.events).toEqual([`GET ${VMUTILS_URL}`, `write ${PATH}`]);
    expect(h.fake.files.get(PATH)?.bytes).toEqual(BINARY.vmalert);
    expect(await h.stack.deploy(h.wired())).toEqual({ dir: 'noop', vmalert: 'noop' });
  });

  test('a declaration refused at apply (a group-writable mode), then fixed: it installs', async () => {
    const h = deployHarness(false);
    await expect(
      h.stack.deploy(h.wired('vmalert', 0o755, undefined, { mode: 0o775 })),
    ).rejects.toThrow('mode must not be group- or world-writable');
    expect(await h.stack.deploy(h.wired())).toEqual({ dir: 'noop', vmalert: 'create' });
    expect(h.fake.files.get(PATH)?.mode).toBe(0o755);
  });

  test('the failed declaration removed instead: its row is dropped, the directory kept', async () => {
    const h = deployHarness(false);
    h.server.serving = false;
    await expect(h.stack.deploy(h.wired())).rejects.toThrow('HTTP 404');
    expect(await h.stack.deploy(h.dirOnly)).toEqual({ dir: 'noop', vmalert: 'delete' });
    expect(h.fake.dirs.has(DIR)).toBe(true);
  });
});
