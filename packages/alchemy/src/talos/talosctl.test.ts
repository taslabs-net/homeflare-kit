/**
 * talosctl binary override. Fake spawner only — the named path is never executed (it only has to
 * exist and be a trusted file; the fake answers `version --client` with the pinned version).
 */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { type FakeCall, fakeSpawner } from './fake-process.ts';
import { TALOSCTL_BINARY_ENV, talosctl } from './talosctl.ts';

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
  await withEnv(process.execPath, async () => {
    const calls: FakeCall[] = [];
    await run('/bin/sh', calls);
    expect(calls[0]?.command).toBe('/bin/sh');
  });
});

test('HF_TALOSCTL selects the binary when the option is omitted', async () => {
  await withEnv(process.execPath, async () => {
    const calls: FakeCall[] = [];
    await run(undefined, calls);
    expect(calls[0]?.command).toBe(process.execPath);
  });
});

test('the default binary name is talosctl', async () => {
  await withEnv(undefined, async () => {
    const calls: FakeCall[] = [];
    await run(undefined, calls);
    expect(calls[0]?.command).toBe('talosctl');
  });
});
