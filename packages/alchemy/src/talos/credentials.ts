/**
 * Talos client material minted from OpenBao, written to a session-temp file whose lifetime the
 * CALLER owns — never this module.
 *
 * ⛔ TALOSCONFIG, MACHINE CONFIG AND secrets.yaml CAN ALL HOLD CLIENT CERTIFICATES AND CLUSTER CA
 *   PRIVATE KEYS. Alchemy persists resource attributes WITHOUT encryption — `StateEncoding.ts`
 *   tags a `Redacted` value as `{ __redacted__: <plaintext> }` (`REDACTED_MARKER`), it does not
 *   encrypt it — and this estate's state store is the shared Cloudflare HTTP state store, not a
 *   database anyone forgets is world-legible. None of these three may ever be a prop, an
 *   attribute or a log line; see docs/plans/2026-09-26-talos-secrets-flow.md for why the OLD
 *   header here (Postgres, `{"@redacted": …}`) was wrong on both counts — the RULE survives the
 *   correction either way.
 *
 * ★ MODELED ON proxmox/credentials.ts + proxmox/mint.ts: mint at call time, use the material, drop
 *   it when the scope ends. The difference is Talos wants a FILE (`--talosconfig` / `-f`), so
 *   minting here writes a temp path and registers its own delete finalizer instead of just
 *   building a header.
 *
 * ⛔ C1 FIX (2026-09-26, K-A3) — THE SHIPPED `mintTalosconfig` DELETED ITS OWN FILE BEFORE ANY
 *   CALLER COULD USE IT. It wrapped its whole body in `Effect.scoped(...)` and registered the
 *   delete finalizer inside that same scope, so the scope — and the file — closed the instant
 *   `mintTalosconfig` RETURNED, before the caller ever got to pass the path to `talosctl`. Fixed
 *   by `Effect.acquireRelease`: it still deletes on every exit path, but contributes `Scope.Scope`
 *   to this module's own return type instead of discharging it, so the file survives until
 *   whichever `Effect.scoped(...)` the CALLER wraps around its own use of the path (every
 *   talos-*.ts resource file wraps its `read`/`reconcile` bodies for exactly this reason now).
 *
 * ⚠️ REASONED FROM THE PUBLISHED TALOS WORKFLOW, NOT MEASURED ON THIS ESTATE. There is no Talos
 *   cluster here yet; KV paths below follow the `mount/<key>` shape O1 (the secrets-flow doc)
 *   assigns, and `bao kv get` inserts the KV-v2 `data/` API segment itself — a key already
 *   prefixed `data/` reads `<mount>/data/data/<key>`, which the OLD default did.
 */
import { closeSync, openSync, writeFileSync } from 'node:fs';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import type * as Scope from 'effect/Scope';
import * as Stream from 'effect/Stream';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { baoEnv } from './bao-env.ts';

/** Where credentials come from. HomeFlare-specific mount names live in the stack, not here. */
export type TalosTarget = {
  /** OpenBao KV mount holding Talos material, e.g. `talos-c1`. */
  readonly mount: string;
  /** Logical cluster name — safe to persist and log. */
  readonly cluster: string;
  /**
   * Path under the mount for the talosconfig YAML. Default `'talosconfig'` — FIXED 2026-09-26;
   * the shipped default was `'data/talosconfig'`, which `bao kv get` turned into
   * `<mount>/data/data/talosconfig` (see the ⚠️ above). It failed closed rather than reading an
   * empty talosconfig, but it would have blocked the very first deploy.
   */
  readonly talosconfigKey?: string;
};

export type TalosCredential = {
  /** Absolute path to a temp talosconfig. ⛔ NEVER PERSIST, NEVER LOG CONTENTS. */
  readonly talosconfigPath: string;
};

const DEFAULT_TALOSCONFIG_KEY = 'talosconfig';

/**
 * Default OpenBao KV path (under `target.mount`) for the admin kubeconfig `Talos.Kubeconfig`
 * writes once at cluster bring-up. See kubeconfig.ts's own header (K-talos-first-boot, 2026-09-26)
 * and docs/plans/2026-09-26-talos-secrets-flow.md's O1 key list.
 */
export const DEFAULT_KUBECONFIG_KEY = 'kubeconfig';

/**
 * Read one OpenBao KV-v2 value and return the first of `fields` that is a non-empty string.
 *
 * ★ THE ONE PLACE THIS PACKAGE SHELLS TO `bao` — talosconfig, per-node machine config and any
 *   future KV-backed Talos material (secrets.yaml, ceph entity keys) all read through this,
 *   so there is exactly one spot that must never echo a KV value on failure.
 * ⛔ stderr ONLY ON FAILURE. stdout may hold the very secret this call exists to fetch.
 */
export const readKvValue = (
  mount: string,
  key: string,
  fields: readonly string[],
): Effect.Effect<string, Error, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const env = baoEnv();
    if (env === undefined) {
      return yield* Effect.fail(
        new Error(
          `bao kv get ${mount}/${key} refused: BAO_ADDR and BAO_TOKEN must both be set. ` +
            "Without them bao would fall back to a cached login in the operator's home.",
        ),
      );
    }
    const result = yield* ChildProcess.make(
      'bao',
      ['kv', 'get', '-format=json', `${mount}/${key}`],
      // ⛔ NO `detached: false`, AND `forceKillAfter` IS SET (round-4 review). Effect detaches on
      //   Unix so `bao` leads its own process group, and the scope finalizer signals the WHOLE group
      //   (`NodeChildProcessSpawner`: `kill(-pid)`). With `detached: false` a `bao` that forked a
      //   sleeper left the grandchild alive, and without `forceKillAfter` a `bao` that ignores
      //   SIGTERM kept connect blocked past its deadline. 1 s after SIGTERM the group gets SIGKILL.
      {
        env,
        extendEnv: false,
        forceKillAfter: Duration.seconds(1),
        stderr: 'pipe',
        stdin: 'ignore',
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
      return yield* Effect.fail(
        new Error(`bao kv get ${mount}/${key} exited ${String(result.exitCode)}: ${result.stderr}`),
      );
    }

    // ⛔ A V8 SyntaxError quotes the offending input; this stdout may hold the secret itself.
    let parsed: { data?: { data?: Record<string, unknown> } };
    try {
      parsed = JSON.parse(result.stdout) as typeof parsed;
    } catch {
      return yield* Effect.fail(
        new Error(`bao kv get ${mount}/${key} returned output that is not JSON (not echoed).`),
      );
    }
    const data = parsed.data?.data;
    for (const field of fields) {
      const raw = data?.[field];
      if (typeof raw === 'string' && raw.trim() !== '') return raw;
    }
    return yield* Effect.fail(
      new Error(
        `${mount}/${key} returned no ${fields.join('/')} field. Never store the value itself in ` +
          'an Alchemy prop or attribute — fix the KV entry, not the caller.',
      ),
    );
  });

/**
 * ★ MEASURED AGAINST OPENBAO v2.6.2 (C1 fix, LAND red team, 2026-09-26 — isolated in-memory
 *   dev server): `bao kv get` on an unwritten KV-v2 key exits 2 with stderr exactly
 *   `No value found at <mount>/data/<key>`. `readKvValue`'s Error embeds that text. It is the
 *   only signal treated as "not written yet"; a permission denial or a transport failure is not.
 */
export const isVaultKeyAbsent = (error: unknown): boolean =>
  error instanceof Error && /no value found at/i.test(error.message);

/**
 * Write `raw` to a session-temp, 0600, exclusively-created file whose lifetime is the CALLER's
 * `Effect.scoped`, not this call's. See the ⛔ C1 FIX note at the top of this file.
 *
 * ⛔ 0600, CREATED EXCLUSIVELY, AND `Bun.write` CANNOT DO EITHER. This file can hold a cluster
 *   admin client certificate or a machine config's bootstrap token. `Bun.write` takes no mode, so
 *   it lands at the process umask — world-readable on this estate — for as long as the resource
 *   runs. The name is unguessable, and "unguessable" is not a permission.
 * ⚠️ `wx` IS THE OTHER HALF. `O_EXCL` means this cannot be made to write through a path an
 *   attacker pre-created (the classic /tmp symlink race), and with a UUIDv7 name a collision is a
 *   genuine error rather than something to paper over.
 * ⚠️ A HARD KILL (SIGKILL, power loss) skips the finalizer and leaves the file behind. 0600 is
 *   what makes that survivable rather than a disclosure.
 */
export const mintKvTempFile = (
  raw: string,
  label: string,
): Effect.Effect<{ readonly path: string }, Error, Scope.Scope> =>
  Effect.gen(function* () {
    const path = `${Bun.env['TMPDIR'] ?? '/tmp'}/hf-talos-${label}-${Bun.randomUUIDv7()}.yaml`;
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
        Effect.tryPromise({ try: () => Bun.file(path).delete(), catch: () => undefined }).pipe(
          Effect.orElseSucceed(() => undefined),
        ),
    );
    return { path };
  });

/**
 * Mint one talosconfig file for `target`.
 *
 * ⛔ CALLERS MUST WRAP THEIR WHOLE USE OF `credential.talosconfigPath` — not just this call — in
 *   `Effect.scoped(...)`. This function's own `Scope.Scope` requirement is what makes that the
 *   caller's job instead of a lie this function tells itself; see the header above.
 */
export const mintTalosconfig = (
  target: TalosTarget,
): Effect.Effect<TalosCredential, Error, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  readKvValue(target.mount, target.talosconfigKey ?? DEFAULT_TALOSCONFIG_KEY, [
    'talosconfig',
    'config',
  ]).pipe(
    Effect.flatMap((raw) => mintKvTempFile(raw, `${target.cluster}-talosconfig`)),
    Effect.map(({ path }): TalosCredential => ({ talosconfigPath: path })),
  );

/**
 * Mint one temp kubeconfig file from the vault copy `Talos.Kubeconfig` writes at bring-up
 * (K-talos-first-boot, 2026-09-26) — the file-shaped counterpart to {@link mintTalosconfig}.
 * `Kubernetes.ClusterAdapter` `talos-openbao` does not use it: connect reads the bytes with
 * {@link readKvValue} and keeps them in memory. This remains for a caller that must hand a
 * path to a process.
 */
export const mintKubeconfig = (
  target: TalosTarget,
  key = DEFAULT_KUBECONFIG_KEY,
): Effect.Effect<
  { readonly path: string },
  Error,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  readKvValue(target.mount, key, ['kubeconfig', 'config']).pipe(
    Effect.flatMap((raw) => mintKvTempFile(raw, `${target.cluster}-kubeconfig`)),
  );
