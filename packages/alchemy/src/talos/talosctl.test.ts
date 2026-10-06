/**
 * talosctl binary override. Fake spawner only — the named path is never executed.
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
      fakeSpawner(() => ({}), calls),
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
  await withEnv('from-env/talosctl', async () => {
    const calls: FakeCall[] = [];
    await run('from-option/talosctl', calls);
    expect(calls[0]?.command).toBe('from-option/talosctl');
  });
});

test('HF_TALOSCTL selects the binary when the option is omitted', async () => {
  await withEnv('from-env/talosctl', async () => {
    const calls: FakeCall[] = [];
    await run(undefined, calls);
    expect(calls[0]?.command).toBe('from-env/talosctl');
  });
});

test('the default binary name is talosctl', async () => {
  await withEnv(undefined, async () => {
    const calls: FakeCall[] = [];
    await run(undefined, calls);
    expect(calls[0]?.command).toBe('talosctl');
  });
});
