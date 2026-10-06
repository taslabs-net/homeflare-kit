/**
 * A fake `ChildProcessSpawner` for offline Talos tests — no real `bao` or `talosctl` process ever
 * starts. Shared by credentials.test.ts and talos-machine-config.test.ts (2026-09-26, K-A3);
 * this package had NO process-level test fake before this file — every Talos resource file spawns
 * a real binary in production and none of that was previously exercised offline.
 *
 * ★ A FULL FAKE SERVICE, NOT A REAL SPAWN WITH A FIXTURE EXECUTABLE ON `PATH`. The alternative —
 *   a tiny fake `bao`/`talosctl` script and a mutated `process.env.PATH` — spawns a REAL OS
 *   process and mutates process-global state for the test's duration, which is exactly the kind
 *   of cross-test interference the house rules ask tests to avoid. `ChildProcessSpawner.make`
 *   takes just a `spawn` function and derives everything else, so a fake `spawn` is the whole cost.
 */
import * as Effect from 'effect/Effect';
import * as Sink from 'effect/Sink';
import * as Stream from 'effect/Stream';
import type { Command } from 'effect/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner';

export type FakeResult = {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
};
export type FakeCall = {
  readonly command: string;
  readonly args: readonly string[];
  /**
   * Decoded stdin text, present only when the real caller piped a `Stream` in (K-talos-first-boot,
   * `credentials-write.ts`'s `writeKvValue`) — the whole reason this fake exists is to prove a
   * value went in via stdin and never via argv, so a test needs to see it.
   */
  readonly stdin?: string;
};
export type FakeHandler = (call: FakeCall) => FakeResult;

const encode = (text: string) => new TextEncoder().encode(text);

const fakeHandle = (result: FakeResult): ChildProcessSpawner.ChildProcessHandle =>
  ChildProcessSpawner.makeHandle({
    all: Stream.fromIterable([encode((result.stdout ?? '') + (result.stderr ?? ''))]),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.exitCode ?? 0)),
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    pid: ChildProcessSpawner.ProcessId(1),
    stderr: Stream.fromIterable([encode(result.stderr ?? '')]),
    stdin: Sink.drain,
    stdout: Stream.fromIterable([encode(result.stdout ?? '')]),
    unref: Effect.succeed(Effect.void),
  });

/**
 * Decode a `StandardCommand`'s `options.stdin` into text, or `undefined` when there was none to
 * decode. Only `"pipe" | "inherit" | "ignore" | "overlapped"` (no bytes) and a raw `Stream` (the
 * only two shapes anything in this package ever passes — `credentials-write.ts`'s `writeKvValue`
 * uses `Stream.fromIterable`, matching `alchemy`'s own `Cloudflare/Workers/ViteChild.ts` usage) are
 * handled; a `StdinConfig` wrapper is unwrapped to its own `.stream` field first.
 */
const stdinText = (stdin: unknown) =>
  Effect.gen(function* () {
    if (stdin === undefined || typeof stdin === 'string') return undefined;
    const stream =
      typeof stdin === 'object' && stdin !== null && 'stream' in stdin
        ? (stdin as { stream: unknown }).stream
        : stdin;
    if (stream === undefined || typeof stream === 'string') return undefined;
    const chunks = yield* Stream.runCollect(stream as Stream.Stream<Uint8Array>);
    return chunks.map((chunk) => new TextDecoder().decode(chunk)).join('');
  }).pipe(Effect.orDie);

/**
 * Build a fake `ChildProcessSpawner.Service` from `handler`, which sees every command's
 * executable + argv (+ decoded stdin, when piped) and returns canned stdout/stderr/exitCode.
 * `credentials.ts` and `talosctl.ts` only ever build `StandardCommand`s (never a piped command),
 * so that is the only shape this fake accepts — a `PipedCommand` is a test-authoring mistake, not
 * something to fake.
 */
export const fakeSpawner = (handler: FakeHandler, calls: FakeCall[] = []) =>
  ChildProcessSpawner.make((command: Command) =>
    Effect.gen(function* () {
      if (command._tag !== 'StandardCommand') {
        return yield* Effect.die(new Error('fake-process: only StandardCommand is supported'));
      }
      const stdin = yield* stdinText(command.options.stdin);
      const call: FakeCall = {
        args: command.args,
        command: command.command,
        ...(stdin === undefined ? {} : { stdin }),
      };
      calls.push(call);
      return fakeHandle(handler(call));
    }),
  );
