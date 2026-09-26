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
import * as Stream from 'effect/Stream';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';

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
    const path = `${Bun.env['TMPDIR'] ?? '/tmp'}/hf-talos-${label}-${Bun.randomUUIDv7()}.yaml`;
    yield* Effect.addFinalizer(() =>
      Effect.tryPromise({ try: () => Bun.file(path).delete(), catch: () => undefined }).pipe(
        Effect.orElseSucceed(() => undefined),
      ),
    );
    return { path };
  });

/**
 * Write one field of an OpenBao KV-v2 value from `value` — never argv, the mirror image of
 * `credentials.ts`'s `readKvValue`.
 *
 * ★ REASONED FROM THE PUBLISHED VAULT/OPENBAO CLI, NOT MEASURED — `field=@-` is the documented
 *   `@path` syntax with `-` as the conventional "read from stdin" path (the secrets-flow doc's own
 *   O-A: "values via `@file`/stdin, ⛔ never argv"). `bao kv put` takes only ONE such field per
 *   invocation here; a multi-field write would need one call per field.
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
    const result = yield* ChildProcess.make(
      'bao',
      ['kv', 'put', `${mount}/${key}`, `${field}=@-`],
      {
        detached: false,
        extendEnv: true,
        stderr: 'pipe',
        stdin: Stream.fromIterable([new TextEncoder().encode(value)]),
        stdout: 'pipe',
      },
    ).pipe(
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
