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
 *
 * ⚠️ ONE PROCESS-GLOBAL EXCEPTION (hunt round 8): importing this file permanently prepends a
 *   never-executed stub `talosctl` directory to `PATH` (`resolveDefault` walks PATH and vets what
 *   it finds, see the comment at that code) and defaults `BAO_ADDR`/`BAO_TOKEN` to placeholders
 *   (`readKvValue` refuses without them). Nothing real is spawned; the mutation outlives the file.
 */
import { chmodSync, realpathSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Effect from 'effect/Effect';
import * as Sink from 'effect/Sink';
import * as Stream from 'effect/Stream';
import type { Command } from 'effect/unstable/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { trustBoundaryForTests } from './trust-boundary.seam.ts';

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
// ★ THE DEFAULT `talosctl` IS RESOLVED ON PATH AND VETTED (talosctl.ts resolveDefault), so a test
//   that never names a binary needs a real, trusted file there. A COMMITTED stub (mode 755, never
//   executed: the fake spawner answers for it) goes first on PATH.
// ⚠️ NOT A TEMP DIR (measured 2026-10-06): the stub was a `mkdtemp` under os.tmpdir() removed by a
//   `process.on('exit')` hook, and `bun test <one file>` leaked it (the house pre-push guard refused
//   the push: `hf-fake-talosctl- 1`). `exit` does not reliably fire under bun test, and a module-level
//   `afterAll` binds only to the FIRST file that imports this (cached) module, so no hook can own
//   the lifetime. A fixture on disk has no lifetime to clean up.
const stubDir = fileURLToPath(new URL('./fixtures/bin', import.meta.url));
// ⚠️ A checkout at umask 002 (CT100's default, measured 2026-10-06) writes the fixture and its dirs
//   775, and the vetting rightly refuses group-writable. Git tracks only the executable bit, so
//   normalising to 755 here changes no tracked content and weakens no check. The walk stops at the
//   boundary (the stub dir), so the file and that dir are all it vets.
chmodSync(stubDir, 0o755);
chmodSync(join(stubDir, 'talosctl'), 0o755);
chmodSync(join(stubDir, 'bao'), 0o755);
export const STUB_TALOSCTL: string = realpathSync(join(stubDir, 'talosctl'));
export const STUB_BAO: string = realpathSync(join(stubDir, 'bao'));
trustBoundaryForTests(stubDir);
// (the boundary is the stub dir itself: it is vetted, nothing above it is)
process.env['PATH'] = `${realpathSync(stubDir)}${delimiter}${process.env['PATH'] ?? ''}`;

export const fakeSpawner = (handler: FakeHandler, calls: FakeCall[] = []) =>
  ChildProcessSpawner.make((command: Command) =>
    Effect.gen(function* () {
      if (command._tag !== 'StandardCommand') {
        return yield* Effect.die(new Error('fake-process: only StandardCommand is supported'));
      }
      // The vetting probe of the default binary is answered, not recorded, so call lists stay the
      // caller's own calls; the recorded command is the bare name the callers asked for.
      const isStub = command.command === STUB_TALOSCTL;
      const isBaoStub = command.command === STUB_BAO;
      if (isStub && command.args[0] === 'version' && command.args[1] === '--client') {
        // ⚠️ A literal, not an import of TALOSCTL_PINNED_VERSION: node-connect.harness.ts loads this
        //   file under Node's strip-only TypeScript, which cannot load talosctl.ts. Drift fails loudly
        //   (every default-binary test then hits the version refusal).
        return fakeHandle({ stdout: 'Client: Tag: v1.14.2' });
      }
      const stdin = yield* stdinText(command.options.stdin);
      const call: FakeCall = {
        args: command.args,
        command: isStub ? 'talosctl' : isBaoStub ? 'bao' : command.command,
        ...(stdin === undefined ? {} : { stdin }),
      };
      calls.push(call);
      return fakeHandle(handler(call));
    }),
  );

// ⚠️ `readKvValue` refuses to run without BAO_ADDR and BAO_TOKEN (no cached-login fallback), so
// every test that fakes `bao` needs both. Placeholders only; the fake spawner never reads them.
process.env['BAO_ADDR'] ??= 'https://bao.invalid';
process.env['BAO_TOKEN'] ??= 'fake-test-token';
