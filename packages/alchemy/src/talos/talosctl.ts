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
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Stream from 'effect/Stream';
import * as ChildProcess from 'effect/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner';
import {
  DEFAULT_TALOSCTL_BINARY,
  TALOSCTL_BINARY_ENV,
  TalosBinaryRefused,
  checkBinaryPath,
  resolveDefault,
} from './talosctl-binary.ts';

export { DEFAULT_TALOSCTL_BINARY, TALOSCTL_BINARY_ENV, TalosBinaryRefused };

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

/** The Talos client version this family is written against (`--client` of the pinned binary). */
export const TALOSCTL_PINNED_VERSION = 'v1.14.2';

const talosctlBinary = (override: string | undefined): string => {
  const fromOption = override?.trim();
  if (fromOption !== undefined && fromOption !== '') return fromOption;
  const fromEnv = process.env[TALOSCTL_BINARY_ENV]?.trim();
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return DEFAULT_TALOSCTL_BINARY;
};

/**
 * ⛔ THE CHILD GETS A MINIMAL ENV, NOT `process.env`: BAO_TOKEN and every other credential in the
 *   caller's environment stay out of an override that is only vetted by path and version. The
 *   talosconfig travels as a file argument, so the binary needs nothing else but `PATH`/`HOME`.
 */
const talosctlEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const name of ['PATH', 'HOME', 'TMPDIR']) {
    const value = process.env[name];
    if (value !== undefined && value !== '') env[name] = value;
  }
  return env;
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
  /**
   * Deadline for the `version --client` probe of the binary; past it the binary is refused (fails
   * closed, never skipped). A cold first run of the Go binary under CI load can exceed a tight
   * limit, so a caller may raise it.
   * @default {@link VERSION_PROBE_TIMEOUT} (10 s)
   */
  readonly versionProbeTimeout?: Duration.Input;
};

const capture = (binary: string, argv: readonly string[]) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return yield* ChildProcess.make(binary, argv, {
      // ⛔ No `detached: false`, plus `forceKillAfter`, as credentials.ts's bao spawn: the child
      //   leads its own process group (killed whole on interrupt) and a SIGTERM-ignoring talosctl
      //   is SIGKILLed 1 s later instead of blocking interruption.
      env: talosctlEnv(),
      extendEnv: false,
      forceKillAfter: Duration.seconds(1),
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
  });

/**
 * ⛔ THE VERSION PROBE IS BOUNDED. `talosctl version --client` talks to no cluster and answers in
 *   milliseconds, so a probe silent for this long is a hung or hostile binary: it is refused
 *   (failed closed, typed) instead of parking the caller forever. Interrupting the scope kills the
 *   child with its process group (proved against a real hanging child by talosctl-probe-kill.test.ts).
 * ⚠️ 10 s, not 3 s: a cold first run of the Go binary under CI load can take seconds, and a
 *   refusal there is a false alarm. Override per call with `TalosRunOptions.versionProbeTimeout`.
 */
export const VERSION_PROBE_TIMEOUT = Duration.seconds(10);

/** ⚠️ EXACT TOKEN MATCH: `includes` would accept v1.14.20 for v1.14.2. */
const reportsPinnedVersion = (stdout: string) =>
  stdout.split(/[^\w.+-]+/).includes(TALOSCTL_PINNED_VERSION);

/**
 * ⛔ AN OVERRIDE MUST REPORT THE PINNED CLIENT VERSION (`version --client`, no talosconfig, so
 *   nothing secret reaches an untrusted binary before it is vetted).
 */
const checkOverrideVersion = (
  binary: string,
  source: string,
  timeout: Duration.Input = VERSION_PROBE_TIMEOUT,
) =>
  capture(binary, ['version', '--client']).pipe(
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () =>
        Effect.fail(
          new TalosBinaryRefused(
            'version --client',
            `${source} did not answer within ${String(Duration.toSeconds(timeout))}s`,
            binary,
          ),
        ),
    }),
    Effect.flatMap((out) =>
      out.exitCode === 0 && reportsPinnedVersion(out.stdout)
        ? Effect.void
        : Effect.fail(
            new TalosBinaryRefused(
              'version --client',
              `${source} is not talosctl ${TALOSCTL_PINNED_VERSION} (exit ${String(out.exitCode)})`,
              binary,
            ),
          ),
    ),
  );

/** Run `talosctl <args…>`. Returns trimmed stdout, or '' when empty. */
export const talosctl = (args: readonly string[], options: TalosRunOptions) =>
  Effect.gen(function* () {
    const requested = talosctlBinary(options.binary);
    const resolved =
      requested === DEFAULT_TALOSCTL_BINARY ? yield* resolveDefault(requested) : requested;
    const fromOption = options.binary?.trim();
    const source =
      requested === DEFAULT_TALOSCTL_BINARY
        ? 'talosctl on PATH'
        : fromOption !== undefined && fromOption !== ''
          ? 'the `binary` option'
          : TALOSCTL_BINARY_ENV;
    // ⛔ Launch exactly the vetted canonical path, for the probe and the credentialed call alike.
    const binary = yield* checkBinaryPath(resolved, source);
    yield* checkOverrideVersion(binary, source, options.versionProbeTimeout);
    const argv = [
      ...args,
      '--talosconfig',
      options.talosconfigPath,
      ...(options.nodes === undefined ? [] : ['--nodes', options.nodes.join(',')]),
      ...(options.endpoints === undefined ? [] : ['--endpoints', options.endpoints.join(',')]),
      ...(options.insecure === true ? ['--insecure'] : []),
    ];
    const result = yield* capture(binary, argv);

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
