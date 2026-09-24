/**
 * `formatCaddyfile(text)` — pipes a Caddyfile through the LOCAL `caddy fmt -` binary (stdin in,
 * formatted text out), the same formatter the `caddy fmt` CLI command runs
 * (caddyconfig/caddyfile Format in caddyserver/caddy).
 *
 * ⛔ THERE IS NO ADMIN API FOR THIS. `caddy fmt` is a CLI-only feature (cmd/commandfuncs.go); no
 *   `/adapt`, `/load` or other admin endpoint formats a Caddyfile, so this never belongs in
 *   `@distilled.cloud/caddy` — measured 2026-09-24. It shells out instead, the same pattern
 *   talos/talosctl.ts uses for a vendor CLI Alchemy does not wrap.
 * ⛔ NEVER REIMPLEMENTED IN TS. The Caddyfile grammar's formatting rules live in the Go adapter;
 *   a hand-rolled formatter would drift from it silently. This module only ever runs the real
 *   binary.
 * ⛔ A MISSING OR FAILING BINARY FAILS THE EFFECT — IT NEVER RETURNS THE INPUT UNCHANGED.
 *   `CaddyFmtNotFound` and `CaddyFmtFailed` are typed, catchTag-able failures (S21); there is no
 *   fallback path that silently skips formatting.
 * ★ WHY THIS MATTERS: admin-calls.ts's module doc — Caddy's adapter warns "Caddyfile input is not
 *   formatted" on EVERY unformatted input (adapter.go FormattingDifference), which shares the
 *   `/load` response body with the refused-but-200 trap. format-warnings.ts surfaces that warning
 *   distinctly in plan/deploy output; this function is how a caller silences it — by formatting
 *   the Caddyfile before declaring it, not by ignoring the warning.
 */
import * as Effect from 'effect/Effect';
import * as Stream from 'effect/Stream';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import type * as PlatformError from 'effect/PlatformError';

/** `caddy` resolved on `PATH`, unless the caller points at a specific build. */
export const DEFAULT_CADDY_BINARY = 'caddy';

/** The configured binary is not on `PATH` (or not executable) — install Caddy, or fix the path. */
export class CaddyFmtNotFound extends Error {
  readonly _tag = 'CaddyFmtNotFound';
  constructor(
    readonly binaryPath: string,
    cause: PlatformError.PlatformError,
  ) {
    super(
      `formatCaddyfile: "${binaryPath}" was not found (${cause.message}). Install Caddy so it is ` +
        'on PATH, or pass { binaryPath } naming the exact build the target Caddy runs.',
    );
    this.name = 'CaddyFmtNotFound';
  }
}

/** The binary ran but exited non-zero — a syntax error in `text`, most likely. */
export class CaddyFmtFailed extends Error {
  readonly _tag = 'CaddyFmtFailed';
  constructor(
    readonly binaryPath: string,
    readonly exitCode: number,
    stderr: string,
  ) {
    super(
      `formatCaddyfile: "${binaryPath} fmt -" exited ${String(exitCode)}: ${stderr.slice(0, 300)}`,
    );
    this.name = 'CaddyFmtFailed';
  }
}

export type FormatCaddyfileOptions = {
  /** The `caddy` binary to run `fmt -` against. @default DEFAULT_CADDY_BINARY, resolved on PATH. */
  readonly binaryPath?: string;
};

/**
 * Format a Caddyfile the way `caddy fmt` would, by actually running it — never a TS
 * reimplementation. Requires `ChildProcessSpawner` (S19: no `node:child_process`, no
 * `async`/`await`); provide `@effect/platform-node`'s or `@effect/platform-bun`'s layer.
 */
export const formatCaddyfile = (
  text: string,
  options: FormatCaddyfileOptions = {},
): Effect.Effect<
  string,
  // ⚠️ A raw PlatformError still escapes for anything that is not "missing binary" (a permission
  //   problem, a process the OS killed mid-run) — narrower than that would misname what happened.
  CaddyFmtNotFound | CaddyFmtFailed | PlatformError.PlatformError,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const binaryPath = options.binaryPath ?? DEFAULT_CADDY_BINARY;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const input = new TextEncoder().encode(text);
    const result = yield* ChildProcess.make(binaryPath, ['fmt', '-'], {
      detached: false,
      stderr: 'pipe',
      stdin: Stream.make(input),
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
              Effect.map((out) => out.trim()),
            ),
            stdout: child.stdout.pipe(Stream.decodeText, Stream.mkString),
          },
          { concurrency: 'unbounded' },
        ),
      ),
      Effect.scoped,
      // ⛔ ENOENT (the binary is missing) becomes the typed, named failure above — every other
      //   PlatformError (a permission problem, a killed process) propagates as-is, still typed.
      Effect.catchTag(
        'PlatformError',
        (error): Effect.Effect<never, CaddyFmtNotFound | PlatformError.PlatformError> =>
          error.reason._tag === 'NotFound'
            ? Effect.fail(new CaddyFmtNotFound(binaryPath, error))
            : Effect.fail(error),
      ),
    );
    if (result.exitCode !== 0) {
      return yield* Effect.fail(new CaddyFmtFailed(binaryPath, result.exitCode, result.stderr));
    }
    return result.stdout;
  });
