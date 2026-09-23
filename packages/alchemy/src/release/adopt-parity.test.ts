/**
 * Adoption through Alchemy's OWN Plan and Apply (openbao/fake-stack.ts): a file already at the path,
 * and a stack holding no state for it. What binary-claim.ts decides, measured end to end — the plan
 * and the apply must give the same answer, and `adopted` must never stand for other bytes.
 *
 * 🔴 EVERY REFUSAL BELOW WAS A SILENT WRITE OR LOSS BEFORE 2026-09-22 (adversarial review of PR 138,
 *   lens: adoption and plan parity), each measured with this harness against the code before the
 *   fix: other bytes under `--adopt` planned `adopted` (resolved) or `create` (directory an Output)
 *   and were downloaded over in place; a symlink planned `adopted` and was refused only at apply;
 *   a renamed declaration claimed the identical file at apply and its old name's delete removed it.
 */
import { describe, expect, test } from 'bun:test';
import { BINARY } from './fake-release.ts';
import { DIR, PATH, THEIRS, deployHarness as harness } from './fake-deploy.ts';

describe('a file already at the path, with no state', () => {
  test('OTHER bytes under --adopt, probed: the plan refuses; nothing fetched, their file kept', async () => {
    const h = harness(true);
    h.place(THEIRS);
    await expect(h.stack.deploy(h.literal, { adopt: true })).rejects.toThrow(
      '--adopt takes over only the pinned binary',
    );
    expect(h.events).toEqual([]);
    expect(h.fake.files.get(PATH)?.bytes).toEqual(THEIRS);
  });

  test('OTHER bytes under --adopt, the directory an Output: refused at apply, before the download', async () => {
    const h = harness(true);
    h.place(THEIRS);
    await expect(h.stack.deploy(h.wired(), { adopt: true })).rejects.toThrow(
      '--adopt takes over only the pinned binary',
    );
    expect(h.events.filter((e) => e.startsWith('GET ') || e.startsWith('write '))).toEqual([]);
    expect(h.fake.files.get(PATH)?.bytes).toEqual(THEIRS);
  });

  test('a symlink under --adopt: refused by the PLAN, not first by the apply', async () => {
    const h = harness(true);
    h.place(new Uint8Array(), 0o755, 'symlink');
    // ★ The plan-side wording; the apply's own would be "is a symlink".
    await expect(h.stack.deploy(h.literal, { adopt: true })).rejects.toThrow(
      'something that is not a regular file',
    );
    expect(h.events).toEqual([]);
  });

  test('the pinned bytes with a wrong mode, under --adopt: adopted, re-written from disk, never fetched', async () => {
    const h = harness(true);
    h.place(BINARY.vmalert, 0o775);
    expect(await h.stack.deploy(h.literal, { adopt: true })).toEqual({ vmalert: 'adopted' });
    expect(h.events).toEqual([`write ${PATH}`]);
    expect(h.fake.files.get(PATH)?.mode).toBe(0o755);
  });

  test('the pinned bytes, the directory an Output, under --adopt: kept, never fetched', async () => {
    const h = harness(true);
    h.place(BINARY.vmalert);
    const planned = await h.stack.deploy(h.wired(), { adopt: true });
    expect(planned).toEqual({ dir: 'adopted', vmalert: 'create' });
    expect(h.events).toEqual([]);
    expect(h.fake.files.get(PATH)?.bytes).toEqual(BINARY.vmalert);
  });

  test('a renamed declaration while its directory changes: refused at apply, the binary kept', async () => {
    const h = harness(false);
    await h.stack.deploy(h.wired('vmalert'));
    h.events.length = 0;
    // The directory's mode change leaves `dir.path` an Output at plan, so nothing probes the path.
    await expect(h.stack.deploy(h.wired('vmalert-rules', 0o750))).rejects.toThrow(
      'it holds the pinned binary, but this stack holds no state for it',
    );
    // 🔴 Before: planned {dir: update, vmalert-rules: create, vmalert: delete}; the new name took
    //   the identical file as its own, the old name's delete removed it, and the deploy succeeded.
    expect(h.events).not.toContain(`remove ${PATH}`);
    expect(h.fake.files.get(PATH)?.bytes).toEqual(BINARY.vmalert);
  });

  test('the same rename declared with renamedFrom (the remedy the refusal names): the binary kept', async () => {
    const h = harness(false);
    await h.stack.deploy(h.wired('vmalert'));
    h.events.length = 0;
    const planned = await h.stack.deploy(h.wired('vmalert-rules', 0o750, 'vmalert'));
    expect(planned).toEqual({ dir: 'update', 'vmalert-rules': 'update' });
    expect(h.events).toEqual([`chmod 750 ${DIR}`]);
    expect(h.fake.files.get(PATH)?.bytes).toEqual(BINARY.vmalert);
  });

  test('the same rename under --adopt: the new name takes the file, the old name leaves it', async () => {
    const h = harness(false);
    await h.stack.deploy(h.wired('vmalert'));
    h.events.length = 0;
    const planned = await h.stack.deploy(h.wired('vmalert-rules', 0o750), { adopt: true });
    expect(planned).toEqual({ dir: 'update', vmalert: 'delete', 'vmalert-rules': 'create' });
    // 🔴 Before 2026-09-22 (release gate): the old name's orphan delete ran `remove ${PATH}` after
    //   the new name had claimed it, and the deploy succeeded with the binary gone.
    expect(h.events).toEqual([`chmod 750 ${DIR}`]);
    expect(h.fake.files.get(PATH)?.bytes).toEqual(BINARY.vmalert);
    // The new name owns it now: the next deploy of the same declaration changes nothing.
    h.events.length = 0;
    expect(await h.stack.deploy(h.wired('vmalert-rules', 0o750))).toEqual({
      dir: 'noop',
      'vmalert-rules': 'noop',
    });
    expect(h.events).toEqual([]);
  });
});
