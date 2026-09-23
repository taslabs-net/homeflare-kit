/**
 * The real HostRunner: this process, this machine, this uid.
 *
 * ★ node:fs AND node:child_process, NOT Bun APIs. An Alchemy stack usually runs under bun, but
 *   the published dist also loads under node (the package's smoke test and the kit's AGENTS.md:
 *   consumers run dist/, not src/), and both runtimes implement these modules.
 * ⛔ NO ELEVATION, EVER. `privileged` is false; a system-domain write succeeds only when the whole
 *   deploy was started as root. See the ⛔ on HostRunner.privileged for why nothing here calls sudo;
 *   the opt-in elevating runner is sudo-runner.ts, which wraps this one.
 * ⛔ NO SHELL. `exec` spawns argv directly, so a label, path or argument can never be re-parsed
 *   as shell syntax.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { groupQuery, parseGroup, parseUser, userQuery } from './host-lookup.ts';
import type { ExecResult, FileStat, HostRunner, WriteOptions } from './runner.ts';

export type LocalRunnerOptions = {
  /** Kill a spawned program after this long. @default 120_000 */
  readonly execTimeoutMs?: number;
};

/** The errno code of a thrown fs error (`ENOENT`, `EACCES`, …), if it has one. */
export const errnoCode = (cause: unknown): string | undefined =>
  typeof cause === 'object' && cause !== null && 'code' in cause
    ? String((cause as { code: unknown }).code)
    : undefined;

/** ENOENT and ENOTDIR both mean "nothing is at this path". */
const absent = (cause: unknown): boolean =>
  errnoCode(cause) === 'ENOENT' || errnoCode(cause) === 'ENOTDIR';

const run = (argv: readonly string[], timeoutMs: number): Promise<ExecResult> =>
  new Promise((resolve, reject) => {
    const [program, ...args] = argv;
    if (program === undefined) {
      reject(new Error('exec: empty argv'));
      return;
    }
    const child = spawn(program, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (cause) => {
      reject(new Error(`exec ${program}: ${cause.message}`));
    });
    child.on('close', (exitCode, signal) => {
      const stderr = Buffer.concat(err).toString('utf8');
      resolve({
        // ⚠️ A signal (including our own timeout) has no exit code; -1 keeps it a failure.
        exitCode: exitCode ?? -1,
        stderr: signal === null ? stderr : `${stderr}\n(killed by ${signal})`.trim(),
        stdout: Buffer.concat(out).toString('utf8'),
      });
    });
  });

const kindOf = (stats: Awaited<ReturnType<typeof lstat>>): FileStat['kind'] => {
  if (stats.isSymbolicLink()) return 'symlink';
  if (stats.isFile()) return 'file';
  if (stats.isDirectory()) return 'directory';
  return 'other';
};

const writeAtomic = async (path: string, bytes: Uint8Array, options: WriteOptions) => {
  // ★ Same directory as the target, so rename(2) never crosses a filesystem (which would EXDEV).
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  // ⛔ 'wx' = O_CREAT|O_EXCL, and 0600 until the final mode: the temp file is never readable by
  //   anyone else in the moment before its mode is set, and never follows a planted symlink.
  const handle = await open(temp, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(bytes);
      // ⚠️ chown BEFORE chmod: a chown by root clears setuid/setgid bits, so the other order
      //   would silently drop a declared 4755.
      if (options.uid !== undefined || options.gid !== undefined) {
        await handle.chown(options.uid ?? -1, options.gid ?? -1);
      }
      await handle.chmod(options.mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } catch (cause) {
    await unlink(temp).catch(() => undefined);
    throw cause;
  }
};

export const localRunner = (options: LocalRunnerOptions = {}): HostRunner => {
  const timeoutMs = options.execTimeoutMs ?? 120_000;
  const platform = process.platform;
  return {
    effectiveUid: () => process.geteuid?.() ?? -1,
    exec: (argv) => run(argv, timeoutMs),
    lookupGroup: async (nameOrId) => {
      const result = await run(groupQuery(platform, nameOrId), timeoutMs);
      return result.exitCode === 0 ? parseGroup(platform, result.stdout) : undefined;
    },
    lookupUser: async (nameOrId) => {
      const result = await run(userQuery(platform, nameOrId), timeoutMs);
      return result.exitCode === 0 ? parseUser(platform, result.stdout) : undefined;
    },
    privileged: false,
    readFile: async (path) => {
      try {
        return new Uint8Array(await readFile(path));
      } catch (cause) {
        if (absent(cause)) return undefined;
        throw cause;
      }
    },
    removeFile: async (path) => {
      try {
        await unlink(path);
      } catch (cause) {
        if (!absent(cause)) throw cause;
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    stat: async (path) => {
      try {
        const stats = await lstat(path);
        return {
          dev: stats.dev,
          gid: stats.gid,
          ino: stats.ino,
          kind: kindOf(stats),
          mode: stats.mode & 0o7777,
          size: stats.size,
          uid: stats.uid,
        };
      } catch (cause) {
        if (absent(cause)) return undefined;
        throw cause;
      }
    },
    writeFileAtomic: writeAtomic,
  };
};
