/**
 * `mintKvTempFile` when the write fails AFTER the exclusive 0600 create (disk full): the release
 * is registered only once the acquire step succeeds, so the file must be removed inside the step.
 * Fails on 0.48.0, which left the partial file behind.
 */
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, spyOn, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { mintKvTempFile } from './mint-temp-file.ts';

const leftovers = (label: string) =>
  fs.readdirSync(tmpdir()).filter((name) => name.startsWith(`hf-talos-${label}-`));

test('a write that fails after the exclusive create leaves no temp file behind', async () => {
  const label = `write-fail-${process.pid}`;
  // A non-string body makes writeFileSync throw after openSync already created the file: a real
  // failure on the real code path, with no stub of node:fs.
  const failure = await Effect.runPromise(
    Effect.flip(Effect.scoped(mintKvTempFile(42 as unknown as string, label))),
  );
  expect(failure.message).toContain(`writing ${label} temp file`);
  expect(leftovers(label)).toEqual([]);
});

test('a close that fails after a good write leaves no temp file behind', async () => {
  const label = `close-fail-${process.pid}`;
  const realClose = fs.closeSync;
  // EIO/EDQUOT surface at close(2): close for real (no leaked fd), then report the failure.
  const spy = spyOn(fs, 'closeSync').mockImplementation((fd: number) => {
    realClose(fd);
    throw new Error('EIO: simulated close failure');
  });
  try {
    const failure = await Effect.runPromise(
      Effect.flip(Effect.scoped(mintKvTempFile('credential\n', label))),
    );
    expect(failure.message).toContain('EIO: simulated close failure');
    expect(spy).toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
  expect(leftovers(label)).toEqual([]);
});
