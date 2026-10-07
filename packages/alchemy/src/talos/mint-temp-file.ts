/**
 * `mintKvTempFile` — the 0600 session-temp file `readKvValue`'s material lands in. Extracted from
 * credentials.ts (2026-10-06, red team PR 355) once the Node-runtime fix pushed that file past the
 * 250-line cap; the split mirrors credentials-write.ts, which was split out for its own header.
 */
import { closeSync, openSync, writeFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Effect from 'effect/Effect';
import type * as Scope from 'effect/Scope';

/**
 * Write `raw` to a session-temp, 0600, exclusively-created file whose lifetime is the CALLER's
 * `Effect.scoped`, not this call's. See the ⛔ C1 FIX note at the top of credentials.ts.
 *
 * ⛔ 0600, CREATED EXCLUSIVELY, AND `Bun.write` CANNOT DO EITHER. This file can hold a cluster
 *   admin client certificate or a machine config's bootstrap token. `Bun.write` takes no mode, so
 *   it lands at the process umask — world-readable on this estate — for as long as the resource
 *   runs. The name is unguessable, and "unguessable" is not a permission.
 * ⚠️ `wx` IS THE OTHER HALF. `O_EXCL` means this cannot be made to write through a path an
 *   attacker pre-created (the classic /tmp symlink race), and with a UUID name a collision is a
 *   genuine error rather than something to paper over.
 * ⚠️ A HARD KILL (SIGKILL, power loss) skips the finalizer and leaves the file behind. 0600 is
 *   what makes that survivable rather than a disclosure.
 */
export const mintKvTempFile = (
  raw: string,
  label: string,
): Effect.Effect<{ readonly path: string }, Error, Scope.Scope> =>
  Effect.gen(function* () {
    // ⛔ NODE, NOT BUN (red team, PR 355): the published dist runs on Node, where `Bun.env` and
    //   `Bun.randomUUIDv7` are missing globals — a `Talos.ClusterHealth` check would hit a
    //   `ReferenceError` before `talosctl` ever ran. `os.tmpdir()` and `node:crypto` `randomUUID`
    //   are the portable equivalents.
    const path = join(tmpdir(), `hf-talos-${label}-${randomUUID()}.yaml`);
    yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const fd = openSync(path, 'wx', 0o600);
          try {
            writeFileSync(fd, raw);
          } finally {
            closeSync(fd);
          }
        },
        catch: (cause) => new Error(`writing ${label} temp file: ${String(cause)}`),
      }),
      () =>
        Effect.tryPromise({ try: () => unlink(path), catch: () => undefined }).pipe(
          Effect.orElseSucceed(() => undefined),
        ),
    );
    return { path };
  });
