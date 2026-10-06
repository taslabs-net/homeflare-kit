/**
 * One `talosctl` invocation — stdout/stderr captured, secrets never echoed.
 *
 * ★ SHELL OUT LIKE ALCHEMY'S DOCKER PROVIDER (ChildProcessSpawner), NOT A SECOND SDK. Talos speaks
 *   gRPC; the published, stable surface for operators is `talosctl`. No Talos npm package is added.
 *
 * ⚠️ REASONED FROM docs.siderolabs.com/talos/v1.13/reference/cli — nothing here was measured on a
 *   live cluster in this session.
 *
 * ⛔ DO NOT LOG STDOUT ON FAILURE. `talosctl kubeconfig` and error paths have been observed in the
 *   wild to include credential material; stderr is the safe diagnostic channel.
 */
import * as Effect from 'effect/Effect';
import * as Stream from 'effect/Stream';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';

/** `talosctl` on `PATH`. A lane pins another build with {@link TALOSCTL_BINARY_ENV} or `binary`. */
export const DEFAULT_TALOSCTL_BINARY = 'talosctl';

export class TalosError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number,
    detail: string,
    binary = DEFAULT_TALOSCTL_BINARY,
  ) {
    super(`${binary} ${command} -> ${String(exitCode)}: ${detail}`);
    this.name = 'TalosError';
  }
}

/**
 * Executable override, read at call time. The Mac PATH measured 2026-10-05 has v1.13.8; the
 * cluster is v1.14.2. Set this to the v1.14.2 binary. A per-call `binary` option wins.
 */
export const TALOSCTL_BINARY_ENV = 'HF_TALOSCTL';

const talosctlBinary = (override: string | undefined): string => {
  const fromOption = override?.trim();
  if (fromOption !== undefined && fromOption !== '') return fromOption;
  const fromEnv = process.env[TALOSCTL_BINARY_ENV]?.trim();
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return DEFAULT_TALOSCTL_BINARY;
};

export type TalosRunOptions = {
  readonly talosconfigPath: string;
  /**
   * `talosctl` executable. Wins over {@link TALOSCTL_BINARY_ENV}.
   * @default `talosctl` on `PATH`, or `HF_TALOSCTL` when that variable is set.
   */
  readonly binary?: string;
  readonly nodes?: readonly string[];
  readonly endpoints?: readonly string[];
  /**
   * `-i/--insecure` — a maintenance-mode node has no established PKI yet. Used by the CREATE apply
   * (resource.ts's own header) and by talos-machine-config.ts's maintenance-mode probe (fix-first
   * #1, PR 307 red team): `--talosconfig` is still passed alongside it, matching the CREATE path,
   * since insecure mode ignores the file's certs rather than requiring their absence.
   */
  readonly insecure?: boolean;
};

/** Run `talosctl <args…>`. Returns trimmed stdout, or '' when empty. */
export const talosctl = (args: readonly string[], options: TalosRunOptions) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const binary = talosctlBinary(options.binary);
    const argv = [
      ...args,
      '--talosconfig',
      options.talosconfigPath,
      ...(options.nodes === undefined ? [] : ['--nodes', options.nodes.join(',')]),
      ...(options.endpoints === undefined ? [] : ['--endpoints', options.endpoints.join(',')]),
      ...(options.insecure === true ? ['--insecure'] : []),
    ];
    const result = yield* ChildProcess.make(binary, argv, {
      detached: false,
      extendEnv: true,
      stderr: 'pipe',
      stdin: 'ignore',
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

    const command = args.join(' ');
    if (result.exitCode !== 0) {
      return yield* Effect.fail(
        new TalosError(command, result.exitCode, result.stderr.slice(0, 300), binary),
      );
    }
    return result.stdout;
  });

/** Like `talosctl`, but exit code 1 with "already" in stderr is treated as success. */
export const talosctlOrAlready = (args: readonly string[], options: TalosRunOptions) =>
  talosctl(args, options).pipe(
    Effect.catchIf(
      (cause): cause is TalosError =>
        cause instanceof TalosError &&
        cause.exitCode !== 0 &&
        /already|exists|bootstrapped/i.test(cause.message),
      () => Effect.succeed(''),
    ),
  );
