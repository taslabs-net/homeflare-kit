/**
 * The one seam between the launchd providers and the host: every file read, file write and
 * `launchctl` call goes through a HostRunner, and nothing in this directory touches the host any
 * other way.
 *
 * ★ WHY A SEAM AND NOT DIRECT node:fs CALLS. launchd has no SDK — the provider renders a plist and
 *   drives `launchctl` — so the only way to test the lifecycle without a real launchd (and without
 *   writing /Library) is to swap the host out. fake-runner.ts is an in-memory host with a scripted
 *   launchd; local-runner.ts is the real one. The same seam is where a consumer plugs in a runner
 *   that reaches a host some other way.
 *
 * ★ PROMISES, NOT EFFECTS, ON PURPOSE. A consumer writing their own runner implements plain async
 *   functions; the providers lift them into Effect at the call site (host-effect.ts).
 */
import * as Context from 'effect/Context';
import * as Layer from 'effect/Layer';

/** One finished process. ⛔ `stdout` may carry anything the job's environment holds — never log it. */
export type ExecResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * What `lstat` says about a path. ⚠️ lstat, not stat: a symlink is reported as a symlink, because
 *   writing through one would change a file this resource never named.
 */
export type FileStat = {
  readonly kind: 'file' | 'directory' | 'symlink' | 'other';
  /** Permission bits only (`& 0o7777`), never the file-type bits. */
  readonly mode: number;
  readonly uid: number;
  readonly gid: number;
  readonly size: number;
};

export type WriteOptions = {
  /** Permission bits for the final file, applied BEFORE it becomes visible at `path`. */
  readonly mode: number;
  /** Numeric owner; omitted means whoever the runner writes as. */
  readonly uid?: number;
  /** Numeric group; omitted means the directory's default. */
  readonly gid?: number;
};

export type HostUser = { readonly uid: number; readonly gid: number; readonly home: string };

export interface HostRunner {
  /**
   * ⛔ DECLARED, NEVER INFERRED. `true` only when every call this runner makes already runs with
   *   root's authority — a runner that talks to a root helper, say. The providers refuse
   *   system-domain writes unless `effectiveUid()` is 0 or this is `true`, so claiming it falsely
   *   turns that refusal into an EACCES halfway through a deploy.
   * ⛔ THE KIT NEVER ELEVATES. No runner here calls `sudo`: a deploy that prompts for a password
   *   mid-plan, or silently uses a cached sudo ticket, is exactly the "no silent sudo" failure. A
   *   consumer who wants elevation writes that runner deliberately and sets this flag.
   */
  readonly privileged: boolean;
  /** The uid file writes and launchctl calls run as. */
  effectiveUid(): number;
  /** Run a program with an argv — ⛔ never through a shell. */
  exec(argv: readonly string[]): Promise<ExecResult>;
  /** File bytes, or `undefined` when nothing is at `path`. */
  readFile(path: string): Promise<Uint8Array | undefined>;
  /** lstat, or `undefined` when nothing is at `path`. */
  stat(path: string): Promise<FileStat | undefined>;
  /**
   * Write `bytes` so that `path` holds either the old file or the new one, never a torn mix:
   * a temporary file in the same directory, mode and owner set on it, then rename(2) over `path`.
   * ⚠️ The parent directory must exist; creating it would invent an owner and mode nobody declared.
   */
  writeFileAtomic(path: string, bytes: Uint8Array, options: WriteOptions): Promise<void>;
  /** Remove a file. Idempotent: nothing at `path` is success. */
  removeFile(path: string): Promise<void>;
  /** A user by name or numeric id, or `undefined` when the host has none. */
  lookupUser(nameOrId: string): Promise<HostUser | undefined>;
  /** A group's gid by name or numeric id, or `undefined` when the host has none. */
  lookupGroup(nameOrId: string): Promise<number | undefined>;
  /** Wait between launchctl polls. ★ Injected so a test never sleeps for real. */
  sleep(ms: number): Promise<void>;
}

/** The Effect service every launchd provider reads its runner from. */
export class HostRunnerService extends Context.Service<HostRunnerService, HostRunner>()(
  'homeflare/launchd/HostRunner',
) {}

/** Provide a runner to the providers: `Layer.provide(hostRunnerLayer(localRunner()))`. */
export const hostRunnerLayer = (runner: HostRunner): Layer.Layer<HostRunnerService> =>
  Layer.succeed(HostRunnerService, runner);

/** True when this runner may write root-owned paths and drive the system domain. */
export const canActAsRoot = (runner: HostRunner): boolean =>
  runner.privileged || runner.effectiveUid() === 0;
