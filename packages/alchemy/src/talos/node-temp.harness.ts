/**
 * ⛔ THE PUBLISHED CODE RUNS ON NODE. `mintKvTempFile` (credentials.ts) and `reservedTempPath`
 *   (credentials-write.ts) once built their path from `Bun.env`/`Bun.randomUUIDv7` — missing globals
 *   on Node, where a `Talos.ClusterHealth` check would hit a `ReferenceError` before `talosctl` ran.
 *   Run under a real `node` process (type stripping) so a Bun-only API here fails CI.
 */
import { existsSync, statSync } from 'node:fs';
import * as Effect from 'effect/Effect';
import { mintKvTempFile } from './credentials.ts';
import { reservedTempPath } from './credentials-write.ts';

const report = (label: string, value: unknown) =>
  process.stdout.write(`${JSON.stringify({ label, value })}\n`);

let tempCreated = false;
let tempMode = -1;
let tempGone = false;
const mintedPath = await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const file = yield* mintKvTempFile('node-body\n', 'c1-node-check');
      tempCreated = existsSync(file.path);
      tempMode = statSync(file.path).mode & 0o777;
      return file.path;
    }),
  ),
);
tempGone = !existsSync(mintedPath);

let reservedPath = '';
const reservedGone = await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const reserved = yield* reservedTempPath('c1-node-reserve');
      reservedPath = reserved.path;
    }),
  ),
).then(() => !existsSync(reservedPath));

report('temp', { tempCreated, tempMode, tempGone, reservedGone });
