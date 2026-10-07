/**
 * `mintKvTempFile` when the write fails AFTER the exclusive 0600 create (disk full): the release
 * is registered only once the acquire step succeeds, so the file must be removed inside the step.
 * Fails on 0.48.0, which left the partial file behind.
 */
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { mintKvTempFile } from './mint-temp-file.ts';

const leftovers = (label: string) =>
  readdirSync(tmpdir()).filter((name) => name.startsWith(`hf-talos-${label}-`));

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
