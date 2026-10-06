/**
 * `HF_TALOSCTL` vetting: path (absolute, lstat, owner, parent directory, mode), exact version, and
 * the minimal child env. Fake spawner only — the named file is never executed.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { type FakeHandler, fakeSpawner } from './fake-process.ts';
import { talosctl } from './talosctl.ts';

const run = (binary: string, handler: FakeHandler = () => ({}), envs: unknown[] = []) =>
  Effect.runPromise(
    Effect.provideService(
      talosctl(['version'], { binary, talosconfigPath: 'unused.yaml' }),
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((cmd) => {
        if (cmd._tag === 'StandardCommand') envs.push(cmd.options);
        return fakeSpawner(handler).spawn(cmd);
      }),
    ),
  ).catch((e: unknown) => String(e));

const dir = mkdtempSync(join(tmpdir(), 'hf-talosctl-vet-'));
chmodSync(dir, 0o755);
afterAll(() => rmSync(dir, { force: true, recursive: true }));
const trusted = (name: string) => {
  const path = join(dir, name);
  writeFileSync(path, '#!/bin/sh\n', { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
};
const pinned =
  (tag: string): FakeHandler =>
  () => ({ stdout: `Client: Tag: ${tag}` });

test('relative, missing, group/world-writable and symlinked overrides are refused', async () => {
  expect(await run('relative/talosctl')).toContain('absolute');
  expect(await run(join(dir, 'missing'))).toContain('not a readable file');
  const bin = trusted('writable');
  chmodSync(bin, 0o777);
  expect(await run(bin)).toContain('group- or world-writable');
  const link = join(dir, 'link');
  symlinkSync(trusted('target'), link);
  expect(await run(link)).toContain('symlink');
});

test('an override in a group- or world-writable directory is refused', async () => {
  const open = join(dir, 'open');
  mkdirSync(open);
  const bin = join(open, 'talosctl');
  writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 });
  chmodSync(open, 0o777);
  expect(await run(bin)).toContain('writable directory');
});

test('the version must match exactly: v1.14.20 and v1.13.8 fail, v1.14.2 passes', async () => {
  const bin = trusted('versions');
  expect(await run(bin, pinned('v1.14.20'))).toContain('v1.14.2');
  expect(await run(bin, pinned('v1.13.8'))).toContain('v1.14.2');
  expect(await run(bin, pinned('v1.14.2'))).toBe('Client: Tag: v1.14.2');
});

test('the child gets a minimal env: BAO_TOKEN never reaches the binary, even the version probe', async () => {
  const saved = process.env['BAO_TOKEN'];
  process.env['BAO_TOKEN'] = 'fake-test-token';
  const options: unknown[] = [];
  try {
    await run(trusted('env'), pinned('v1.14.2'), options);
  } finally {
    if (saved === undefined) delete process.env['BAO_TOKEN'];
    else process.env['BAO_TOKEN'] = saved;
  }
  expect(options.length).toBe(2);
  for (const option of options as { env?: Record<string, string>; extendEnv?: boolean }[]) {
    expect(option.extendEnv).toBe(false);
    expect(Object.keys(option.env ?? {})).not.toContain('BAO_TOKEN');
    expect(Object.keys(option.env ?? {})).not.toContain('BAO_ADDR');
  }
});
