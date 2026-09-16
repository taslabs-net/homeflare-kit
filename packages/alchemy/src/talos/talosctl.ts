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

export class TalosError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number,
    detail: string,
  ) {
    super(`talosctl ${command} -> ${String(exitCode)}: ${detail}`);
    this.name = 'TalosError';
  }
}

export type TalosRunOptions = {
  readonly talosconfigPath: string;
  readonly nodes?: readonly string[];
  readonly endpoints?: readonly string[];
};

/** Run `talosctl <args…>`. Returns trimmed stdout, or '' when empty. */
export const talosctl = (args: readonly string[], options: TalosRunOptions) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const argv = [
      ...args,
      '--talosconfig',
      options.talosconfigPath,
      ...(options.nodes === undefined ? [] : ['--nodes', options.nodes.join(',')]),
      ...(options.endpoints === undefined ? [] : ['--endpoints', options.endpoints.join(',')]),
    ];
    const result = yield* ChildProcess.make('talosctl', argv, {
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
        new TalosError(command, result.exitCode, result.stderr.slice(0, 300)),
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
