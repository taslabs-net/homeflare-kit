/**
 * HostDirectory against the fake host: the resource that exists because every file resource refuses
 * to create a parent.
 */
import { describe, expect, test } from 'bun:test';
import {
  deleteDirectory,
  diffDirectory,
  directoryProblems,
  readDirectory,
  reconcileDirectory,
} from './directory-lifecycle.ts';
import { readInterruptedDirectory } from './directory-read.ts';
import { fakeLinuxHost } from './fake-linux-host.ts';

const host = () =>
  fakeLinuxHost({
    dirs: { '/opt/app': 0 },
    groups: { app: 60 },
    users: { app: { gid: 60, home: '/opt/app', uid: 900 } },
  });

describe('create', () => {
  test('makes the directory with the declared mode and owner, then reads it back', async () => {
    const fake = host();
    const attrs = await reconcileDirectory(fake.runner, {
      group: 'app',
      mode: 0o750,
      owner: 'app',
      path: '/opt/app/etc',
    });
    expect(attrs).toEqual({ gid: 60, mode: 0o750, path: '/opt/app/etc', uid: 900 });
    // ⚠️ `mkdir -m` carries the mode, so a umask never masks a declared bit.
    expect(fake.calls.some((call) => call[0] === 'mkdir' && call.includes('750'))).toBe(true);
  });

  test('a missing parent is a refusal that names it, never an mkdir -p', async () => {
    const fake = host();
    await expect(reconcileDirectory(fake.runner, { path: '/opt/app/one/two' })).rejects.toThrow(
      /its parent \/opt\/app\/one does not exist/,
    );
    expect(fake.calls.some((call) => call.includes('-p'))).toBe(false);
  });

  test('a path that is a file is refused rather than replaced', async () => {
    const fake = host();
    await fake.runner.writeFileAtomic('/opt/app/thing', new Uint8Array(), { mode: 0o644 });
    await expect(reconcileDirectory(fake.runner, { path: '/opt/app/thing' })).rejects.toThrow(
      /is a file, not a directory/,
    );
  });
});

describe('drift', () => {
  test('a hand chmod is an update, and reconcile puts it back', async () => {
    const fake = host();
    const output = await reconcileDirectory(fake.runner, { mode: 0o750, path: '/opt/app/etc' });
    expect(await diffDirectory(fake.runner, { mode: 0o750, path: '/opt/app/etc' }, output)).toEqual(
      {
        action: 'noop',
      },
    );
    const live = fake.modes.get('/opt/app/etc');
    if (live !== undefined) live.mode = 0o777;
    expect(await diffDirectory(fake.runner, { mode: 0o750, path: '/opt/app/etc' }, output)).toEqual(
      {
        action: 'update',
      },
    );
    const fixed = await reconcileDirectory(
      fake.runner,
      { mode: 0o750, path: '/opt/app/etc' },
      output,
    );
    expect(fixed.mode).toBe(0o750);
  });

  test('a directory that is not this resource is refused unless adoption is on', async () => {
    const fake = host();
    await reconcileDirectory(fake.runner, { mode: 0o700, path: '/opt/app/etc' });
    await expect(
      reconcileDirectory(fake.runner, { mode: 0o755, path: '/opt/app/etc' }),
    ).rejects.toThrow(/deploy with --adopt/);
    const adopted = await reconcileDirectory(
      fake.runner,
      { mode: 0o755, path: '/opt/app/etc' },
      undefined,
      true,
    );
    expect(adopted.mode).toBe(0o755);
  });

  test('a directory that already matches is not touched — not even a no-op chown', async () => {
    const fake = host();
    const props = { group: 'app', mode: 0o755, owner: 'app', path: '/opt/app/etc' };
    const output = await reconcileDirectory(fake.runner, props);
    const before = fake.calls.length;
    await reconcileDirectory(fake.runner, props, output);
    const after = fake.calls.slice(before).map((call) => call[0]);
    expect(after).not.toContain('mkdir');
    expect(after).not.toContain('chmod');
    // ⛔ A chown that changes nothing is still a write on the host and a line in the deploy log.
    expect(after).not.toContain('chown');
  });
});

describe('argv', () => {
  test('chmod and chown omit -- on Darwin; mkdir keeps it on every platform', async () => {
    const fake = host();
    const created = await reconcileDirectory(fake.runner, {
      group: 0,
      mode: 0o755,
      owner: 0,
      path: '/opt/app/bin',
    });
    await reconcileDirectory(
      fake.runner,
      { group: 0, mode: 0o750, owner: 0, path: '/opt/app/bin' },
      created,
    );
    const gnu = process.platform !== 'darwin';
    const chown = fake.calls.find((call) => call[0] === 'chown');
    const chmod = fake.calls.find((call) => call[0] === 'chmod');
    const mkdir = fake.calls.find((call) => call[0] === 'mkdir');
    expect(chown?.includes('--')).toBe(gnu);
    expect(chmod?.includes('--')).toBe(gnu);
    expect(mkdir).toContain('--');
  });
});

describe('delete', () => {
  test('is rmdir: a directory that still holds a file is a refusal', async () => {
    const fake = host();
    const attrs = await reconcileDirectory(fake.runner, { path: '/opt/app/etc' });
    await fake.runner.writeFileAtomic('/opt/app/etc/kept.conf', new Uint8Array(), { mode: 0o644 });
    await expect(deleteDirectory(fake.runner, attrs)).rejects.toThrow(/Directory not empty/);
    expect(fake.calls.some((call) => call.includes('-r') || call.includes('-rf'))).toBe(false);
  });

  test('an empty directory goes, and a second delete is a no-op', async () => {
    const fake = host();
    const attrs = await reconcileDirectory(fake.runner, { path: '/opt/app/etc' });
    await deleteDirectory(fake.runner, attrs);
    expect(await readDirectory(fake.runner, '/opt/app/etc')).toBeUndefined();
    await deleteDirectory(fake.runner, attrs);
  });
});

describe('validation', () => {
  test('refuses a relative or unnormalised path and an impossible mode', () => {
    expect(directoryProblems({ path: 'opt/app' })).toContain('path must be absolute');
    expect(directoryProblems({ path: '/opt/../etc' }).length).toBeGreaterThan(0);
    expect(directoryProblems({ mode: 0o10000, path: '/opt/app' })).toContain(
      'mode must be 0–0o7777',
    );
  });
});

describe('an interrupted create', () => {
  test('a missing path is not stat-ed, and a probe still fails', async () => {
    const fake = host();
    let stats = 0;
    const runner = {
      ...fake.runner,
      stat: async (path: string) => {
        stats += 1;
        return fake.runner.stat(path);
      },
    };
    expect(await readInterruptedDirectory(runner, undefined, true)).toBeUndefined();
    await expect(readInterruptedDirectory(runner, undefined, false)).rejects.toThrow(
      'path must be a string',
    );
    expect(stats).toBe(0);
  });
});
