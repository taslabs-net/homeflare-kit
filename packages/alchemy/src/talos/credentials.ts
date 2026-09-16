/**
 * The Talos client credential a reconcile runs with: minted from OpenBao, written to a temp file.
 *
 * ⛔ TALOSCONFIG AND secrets.yaml HOLD CLIENT CERTIFICATES AND CLUSTER CA PRIVATE KEYS. Alchemy
 *   persists resource attributes WITHOUT encryption — StateEncoding.ts writes `Redacted` as
 *   `{"@redacted": <plaintext>}` — and this estate's state store is the `alchemy` Postgres that
 *   pg-backup.sh dumps nightly. Neither file may be a prop, an attribute, or a log line.
 *
 * ★ MODELED ON house/proxmox/src/credentials.ts: mint at call time through `ChildProcessSpawner`,
 *   use the material to build a client, drop it when the scope ends. The difference is Talos wants a
 *   FILE (`--talosconfig` / `TALOSCONFIG`), so mint writes a temp path and registers cleanup.
 *
 * ⚠️ REASONED FROM THE PUBLISHED TALOS WORKFLOW, NOT MEASURED ON THIS ESTATE. There is no Talos
 *   cluster here yet; paths below follow the same `mount/data/…` shape other infra mounts use.
 */
import { closeSync, openSync, writeFileSync } from 'node:fs';
import * as Effect from 'effect/Effect';
import * as Stream from 'effect/Stream';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';

/** Where credentials come from. HomeFlare-specific mount names live in the stack, not here. */
export type TalosTarget = {
  /** OpenBao KV mount holding Talos material, e.g. `talos-tb4`. */
  readonly mount: string;
  /** Logical cluster name — safe to persist and log. */
  readonly cluster: string;
  /**
   * Path under the mount for the talosconfig YAML.
   *
   * ⚠️ DEFAULT IS REASONED. The first real deploy will confirm or correct the path; a wrong path
   *   fails closed with a bao error rather than writing an empty talosconfig.
   */
  readonly talosconfigKey?: string;
};

export type TalosCredential = {
  /** Absolute path to a temp talosconfig. ⛔ NEVER PERSIST, NEVER LOG CONTENTS. */
  readonly talosconfigPath: string;
};

const defaultKey = (target: TalosTarget) => target.talosconfigKey ?? 'data/talosconfig';

/**
 * Mint one talosconfig file for `target`.
 *
 * ★ SHELLS OUT TO `bao` RATHER THAN SPEAKING THE HTTP API — same reasoning as proxmox credentials.
 *   The estate's BAO_ADDR / BAO_NAMESPACE / approle contract already lives in that binary.
 */
export const mintTalosconfig = (target: TalosTarget) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const key = defaultKey(target);
      const result = yield* ChildProcess.make(
        'bao',
        ['kv', 'get', '-format=json', `${target.mount}/${key}`],
        { detached: false, extendEnv: true, stderr: 'pipe', stdin: 'ignore', stdout: 'pipe' },
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
              stdout: child.stdout.pipe(
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
        // ⛔ stderr ONLY — stdout may hold talosconfig YAML with client credentials.
        return yield* Effect.fail(
          new Error(
            `bao kv get ${target.mount}/${key} exited ${String(result.exitCode)}: ${result.stderr}`,
          ),
        );
      }

      const parsed = JSON.parse(result.stdout) as { data?: { data?: Record<string, unknown> } };
      const data = parsed.data?.data;
      const raw = data?.['talosconfig'] ?? data?.['config'];
      if (typeof raw !== 'string' || raw.trim() === '') {
        return yield* Effect.fail(
          new Error(
            `${target.mount}/${key} returned no talosconfig field. Expected a KV key named 'talosconfig' or 'config' — never store the value in Alchemy props.`,
          ),
        );
      }

      const talosconfigPath = `${Bun.env['TMPDIR'] ?? '/tmp'}/hf-talos-${target.cluster}-${Bun.randomUUIDv7()}.yaml`;
      /**
       * ⛔ 0600, CREATED EXCLUSIVELY, AND `Bun.write` CANNOT DO EITHER. This file holds the
       *   cluster's admin client certificate — everything talosctl needs to reconfigure or wipe a
       *   node. `Bun.write` takes no mode, so it lands at the process umask, which on this estate
       *   is 0644: world-readable, in a world-readable directory, for as long as the resource
       *   runs. The name is unguessable, and "unguessable" is not a permission.
       * ⚠️ `wx` IS THE OTHER HALF. Opening with O_EXCL means this cannot be made to write through
       *   a path an attacker pre-created — the classic /tmp symlink race — and with a UUIDv7 name
       *   a collision is a genuine error rather than something to paper over.
       * ⚠️ THE FINALIZER BELOW REMOVES IT ON EVERY EXIT PATH, but a hard kill (SIGKILL, power
       *   loss) leaves it behind. 0600 is what makes that survivable rather than a disclosure.
       */
      yield* Effect.try({
        try: () => {
          const fd = openSync(talosconfigPath, 'wx', 0o600);
          try {
            writeFileSync(fd, raw);
          } finally {
            closeSync(fd);
          }
        },
        catch: (cause) => new Error(`writing temp talosconfig: ${String(cause)}`),
      });

      yield* Effect.addFinalizer(() =>
        Effect.tryPromise({
          try: () => Bun.file(talosconfigPath).delete(),
          catch: () => undefined,
        }).pipe(Effect.orElseSucceed(() => undefined)),
      );

      return { talosconfigPath } satisfies TalosCredential;
    }),
  );
