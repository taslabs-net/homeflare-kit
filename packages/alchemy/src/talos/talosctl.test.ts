/**
 * talosctl binary override. Fake spawner only — the named path is never executed (it only has to
 * exist and be a trusted file; the fake answers `version --client` with the pinned version).
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { type FakeCall, fakeSpawner } from './fake-process.ts';
import { TALOSCTL_BINARY_ENV, talosctl } from './talosctl.ts';

// ⚠️ A real, vetted file in a private directory: the system `sh` or `bun` may be a symlink or live
//   in a writable directory, which the vetting (correctly) refuses.
const dir = mkdtempSync(join(tmpdir(), 'hf-talosctl-'));
chmodSync(dir, 0o755);
const fixture = join(dir, 'talosctl');
writeFileSync(fixture, '#!/bin/sh\n', { mode: 0o755 });
chmodSync(fixture, 0o755);
afterAll(() => rmSync(dir, { force: true, recursive: true }));

const run = (binary: string | undefined, calls: FakeCall[]) =>
  Effect.runPromise(
    Effect.provideService(
      talosctl(['version'], {
        talosconfigPath: 'unused-talosconfig.yaml',
        ...(binary === undefined ? {} : { binary }),
      }),
      ChildProcessSpawner.ChildProcessSpawner,
      fakeSpawner(() => ({ stdout: 'Client: Tag: v1.14.2' }), calls),
    ),
  );

const withEnv = async (value: string | undefined, body: () => Promise<void>) => {
  const saved = process.env[TALOSCTL_BINARY_ENV];
  if (value === undefined) delete process.env[TALOSCTL_BINARY_ENV];
  else process.env[TALOSCTL_BINARY_ENV] = value;
  try {
    await body();
  } finally {
    if (saved === undefined) delete process.env[TALOSCTL_BINARY_ENV];
    else process.env[TALOSCTL_BINARY_ENV] = saved;
  }
};

test('the binary option wins over HF_TALOSCTL', async () => {
  await withEnv('/definitely/not/here/talosctl', async () => {
    const calls: FakeCall[] = [];
    await run(fixture, calls);
    expect(calls[0]?.command).toBe(fixture);
  });
});

test('HF_TALOSCTL selects the binary when the option is omitted', async () => {
  await withEnv(fixture, async () => {
    const calls: FakeCall[] = [];
    await run(undefined, calls);
    expect(calls[0]?.command).toBe(fixture);
  });
});

test('the default binary name is talosctl', async () => {
  await withEnv(undefined, async () => {
    const calls: FakeCall[] = [];
    await run(undefined, calls);
    expect(calls[0]?.command).toBe('talosctl');
  });
});
