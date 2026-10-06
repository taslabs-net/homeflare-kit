/**
 * `HF_TALOSCTL` vetting: path (absolute, lstat, owner, parent directory, mode), exact version, and
 * the minimal child env. Fake spawner only — the named file is never executed.
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { type FakeHandler, fakeSpawner } from './fake-process.ts';
import { trustBoundaryForTests } from './trust-boundary.ts';
import { TalosBinaryRefused, TalosError, talosctl } from './talosctl.ts';

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
trustBoundaryForTests(dir);
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

test('a writable ancestor of the override is refused (fails on 37d835a: only the parent was checked)', async () => {
  const outer = join(dir, 'outer');
  mkdirSync(join(outer, 'inner'), { recursive: true });
  const bin = join(outer, 'inner', 'talosctl');
  writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 });
  chmodSync(join(outer, 'inner'), 0o755);
  chmodSync(outer, 0o777);
  expect(await run(bin, pinned('v1.14.2'))).toContain('writable directory');
});

test('an ancestor owned by another user is refused (fails on 37d835a: parent owner never read)', async () => {
  const owner = join(dir, 'foreign');
  mkdirSync(owner);
  const bin = join(owner, 'talosctl');
  writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 });
  chmodSync(owner, 0o755);
  expect(await run(bin, pinned('v1.14.2'))).toBe('Client: Tag: v1.14.2');
  const real = process.getuid;
  // Everything here is ours; pretending to be another uid makes every directory foreign.
  Object.defineProperty(process, 'getuid', { configurable: true, value: () => 4242 });
  try {
    expect(await run(bin, pinned('v1.14.2'))).toContain('directory owned by another user');
  } finally {
    Object.defineProperty(process, 'getuid', { configurable: true, value: real });
  }
});

test('a non-executable override is refused', async () => {
  const bin = join(dir, 'noexec');
  writeFileSync(bin, '#!/bin/sh\n', { mode: 0o644 });
  chmodSync(bin, 0o644);
  expect(await run(bin, pinned('v1.14.2'))).toContain('not executable');
});

test('both launches use the canonical path even if an ancestor symlink is swapped (fails on ede1f6f)', async () => {
  const real = join(dir, 'real-bin');
  const evil = join(dir, 'evil-bin');
  for (const d of [real, evil]) {
    mkdirSync(d);
    chmodSync(d, 0o755);
    writeFileSync(join(d, 'talosctl'), '#!/bin/sh\n', { mode: 0o755 });
    chmodSync(join(d, 'talosctl'), 0o755);
  }
  const via = join(dir, 'via');
  symlinkSync(real, via);
  const launched: string[] = [];
  const out = await Effect.runPromise(
    Effect.provideService(
      talosctl(['version'], { binary: join(via, 'talosctl'), talosconfigPath: 'unused.yaml' }),
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((cmd) => {
        if (cmd._tag === 'StandardCommand') launched.push(cmd.command);
        // The attacker repoints the link right after the version probe.
        rmSync(via);
        symlinkSync(evil, via);
        return fakeSpawner(pinned('v1.14.2')).spawn(cmd);
      }),
    ),
  );
  expect(out).toBe('Client: Tag: v1.14.2');
  expect(launched.length).toBe(2);
  expect(launched[0]).toBe(join(realpathSync(real), 'talosctl'));
  expect(launched[1]).toBe(launched[0]);
});

test('a refusal is a TalosBinaryRefused naming its source, never a TalosError', async () => {
  const outcome = await Effect.runPromise(
    Effect.flip(
      Effect.provideService(
        talosctl(['version'], { binary: 'relative/talosctl', talosconfigPath: 'x' }),
        ChildProcessSpawner.ChildProcessSpawner,
        fakeSpawner(() => ({})),
      ),
    ),
  );
  expect(outcome).toBeInstanceOf(TalosBinaryRefused);
  expect(outcome).not.toBeInstanceOf(TalosError);
  expect(String(outcome)).toContain('HF_TALOSCTL');
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
