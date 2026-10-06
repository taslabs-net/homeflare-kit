/**
 * The write half of Talos's OpenBao KV access — split out of credentials.ts (2026-09-26,
 * K-talos-first-boot) once it needed its own header, the same reason machine-config-read.ts,
 * machine-config-poll.ts and talos-errors.ts were split out of talos-machine-config.ts before it.
 * `credentials.ts` stays the read side (mint a talosconfig, read a KV value); this file is the one
 * place anything in this package ever writes TO OpenBao.
 *
 * ★ FIRST CALLER: `Talos.Kubeconfig` (kubeconfig.ts) writing the admin kubeconfig it generates at
 *   cluster bring-up into the vault instead of an un-vaulted host `runtimePath` — see that file's
 *   own header. `Ceph.AuthEntity` (K-A4, a separate design/PR) is expected to need the same shape
 *   for its own vault-written entity keys; this is not yet shared with it on purpose — two callers
 *   is the point at which sharing stops being speculative.
 */
import * as Effect from 'effect/Effect';
import type * as Scope from 'effect/Scope';
import * as Duration from 'effect/Duration';
import * as Stream from 'effect/Stream';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { baoEnv } from './bao-env.ts';
import { resolveBao } from './talosctl-binary.ts';

/**
 * A fresh, unguessable temp path for SOME OTHER PROCESS (talosctl) to create — unlike
 * `credentials.ts`'s `mintKvTempFile`, this does NOT pre-create the file with `wx`, because the
 * caller here is capturing a command's OWN output rather than writing known content itself. The
 * random UUIDv7 name is the only pre-fabrication guard (an attacker cannot pre-plant a symlink at a
 * path it cannot predict) — first used by `kubeconfig.ts` to capture `talosctl kubeconfig`'s
 * generated file before reading it back and writing it into the vault.
 */
export const reservedTempPath = (
  label: string,
): Effect.Effect<{ readonly path: string }, never, Scope.Scope> =>
  Effect.gen(function* () {
    const path = join(tmpdir(), `hf-talos-${label}-${randomUUID()}.yaml`);
    yield* Effect.addFinalizer(() =>
      Effect.tryPromise({ try: () => unlink(path), catch: () => undefined }).pipe(
        Effect.orElseSucceed(() => undefined),
      ),
    );
    return { path };
  });

/**
 * Write one field of an OpenBao KV-v2 value from `value` — never argv, the mirror image of
 * `credentials.ts`'s `readKvValue`.
 *
 * ⛔ C2 FIX (LAND red team, 2026-09-26) — `field=@-` IS WRONG AND WAS NEVER MEASURED. `@value` means
 *   "read a file at this path"; a literal path of `-` is not the stdin convention for `@` — it is
 *   just a file named `-`. MEASURED against the estate's OpenBao v2.6.2 binary (isolated in-memory
 *   dev server, `env -i`, scratch HOME, no estate credentials involved; server removed after):
 *   `field=@-` exits 1 with `invalid key/value pair "field=@-": error reading file: open -: no
 *   such file or directory`, and if a file literally named `-` exists in the working directory it
 *   silently stores THAT file's bytes instead. `field=-` (no `@`) is Vault/OpenBao's own stdin
 *   convention and was confirmed against the same binary to read the piped bytes correctly. Every
 *   `Talos.Kubeconfig` create failed here — AFTER `talosctl kubeconfig` had already issued a fresh
 *   admin client certificate, which cannot be revoked.
 * ⛔ stderr ONLY ON FAILURE — same rule as `readKvValue`: never echo what was being written, on
 *   success or failure.
 */
export const writeKvValue = (
  mount: string,
  key: string,
  field: string,
  value: string,
): Effect.Effect<void, Error, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    // ⛔ Same vetting as `readKvValue`: `bao` writes credentials, so it is resolved and vetted before
    //   any env is built or passed — a fake `bao` in a writable PATH folder is refused, never launched.
    const bao = yield* resolveBao();
    const env = baoEnv();
    if (env === undefined) {
      return yield* Effect.fail(
        new Error(
          `bao kv put ${mount}/${key} refused: BAO_ADDR and BAO_TOKEN must both be set. ` +
            "Without them bao would fall back to a cached login in the operator's home.",
        ),
      );
    }
    const result = yield* ChildProcess.make(bao, ['kv', 'put', `${mount}/${key}`, `${field}=-`], {
      env,
      extendEnv: false,
      // ⛔ Mirror readKvValue's spawn: `bao` leads its own process group (killed whole on interrupt)
      //   and a SIGTERM-ignoring `bao` is SIGKILLed 1 s later instead of blocking the plan.
      forceKillAfter: Duration.seconds(1),
      stderr: 'pipe',
      stdin: Stream.fromIterable([new TextEncoder().encode(value)]),
      stdout: 'pipe',
    }).pipe(
      spawner.spawn,
      Effect.flatMap((child) =>
        Effect.all(
          {
            exitCode: child.exitCode,
            stderr: child.stderr.pipe(
              Stream.decodeText,
              Stream.mkString,
              Effect.map((text) => text.trim()),
            ),
          },
          { concurrency: 'unbounded' },
        ),
      ),
      Effect.scoped,
    );

    if (result.exitCode !== 0) {
      return yield* Effect.fail(
        new Error(`bao kv put ${mount}/${key} exited ${String(result.exitCode)}: ${result.stderr}`),
      );
    }
  });
