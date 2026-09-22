/**
 * `sshRunner()` — the estate's Linux hosts behind the SAME HostRunner seam the launchd family
 * already drives a Mac through (launchd/runner.ts). Every provider in this directory reaches its
 * host only through it, so the whole Linux lifecycle runs against a fake in tests.
 *
 * ★ WHY THE SAME SEAM AND NOT A SECOND ONE. HostRunner is nine promise-returning methods with no
 *   macOS in them; what was Mac-specific was launchctl and the plist, not the seam. Reusing it
 *   means HostFile, the ownership rules and `checkWrite` already work on Linux, and a stack can
 *   hand the same runner to a file, a directory and a unit.
 * ⛔ NO PASSWORDS AND NO SILENT SUDO. Every connection is `BatchMode=yes` (ssh-command.ts), and
 *   `privileged` is false: this runner never calls sudo. A root-owned path therefore needs a
 *   destination whose ssh user IS root — which is how the estate already reaches its hypervisors —
 *   or a privileged runner of the caller's own. See docs/linux-host.md; the Linux twin of
 *   sudoRunner is deliberately a later, separate change with its own allowlist.
 * ⛔ FAIL CLOSED. A connection that drops, a host key that changed, a shell that cannot parse the
 *   script: none of them produces a "not found". Without the framing marker the result is an
 *   Error, never data (ssh-command.ts parseFramed).
 * ⚠️ ONE CONNECTION PER CALL. No multiplexing is configured here: a deploy over a slow link pays a
 *   handshake per read. Pass `sshArgs: ['-o', 'ControlMaster=auto', …]` to opt into your own
 *   ControlPersist socket — the kit does not create one behind your back, because a stale socket
 *   outliving the deploy is a surprise nobody declared.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { groupQuery, parseGroup, parseUser, userQuery } from '../launchd/host-lookup.ts';
import type { ExecResult, HostRunner } from '../launchd/runner.ts';
import { ABSENT, frameScript, parseFramed, sshArgv } from './ssh-command.ts';
import {
  execScript,
  parseStat,
  readScript,
  removeScript,
  statScript,
  writeScript,
} from './ssh-scripts.ts';

export type SshRunnerOptions = {
  /** The destination exactly as the operator's own ssh config names it (`Host` block or user@host). */
  readonly host: string;
  /** Extra ssh options, after the fixed safety set and before the destination. */
  readonly sshArgs?: readonly string[];
  /** Kill a connection after this long. @default 120_000 */
  readonly execTimeoutMs?: number;
  /** ssh's own `ConnectTimeout`. @default 10 */
  readonly connectTimeoutSec?: number;
};

type Raw = { exitCode: number; stdout: string; stderr: string; signal: string | null };

const spawnSsh = (argv: readonly string[], timeoutMs: number, stdin?: Uint8Array): Promise<Raw> =>
  new Promise((resolve, reject) => {
    const [program, ...args] = argv as [string, ...string[]];
    const child = spawn(program, args, {
      shell: false,
      stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (cause) => {
      reject(new Error(`ssh: ${cause.message}`));
    });
    if (stdin !== undefined && child.stdin !== null) {
      // ⚠️ EPIPE is normal here: the remote `cat` can die before we finish writing, and the real
      //   failure is the exit code we are about to read — not a crash in this process.
      child.stdin.on('error', () => undefined);
      child.stdin.end(stdin);
    }
    child.on('close', (exitCode, signal) => {
      resolve({
        exitCode: exitCode ?? -1,
        signal,
        stderr: Buffer.concat(err).toString('utf8'),
        stdout: Buffer.concat(out).toString('utf8'),
      });
    });
  });

/** What the process on the far end did — or an Error, when we cannot say that it ran at all. */
export const runRemote = async (
  options: Required<Pick<SshRunnerOptions, 'host' | 'connectTimeoutSec' | 'execTimeoutMs'>> &
    Pick<SshRunnerOptions, 'sshArgs'>,
  nonce: string,
  script: string,
  stdin?: Uint8Array,
): Promise<ExecResult> => {
  const argv = sshArgv(options.host, frameScript(script, nonce), {
    connectTimeoutSec: options.connectTimeoutSec,
    ...(options.sshArgs === undefined ? {} : { sshArgs: options.sshArgs }),
  });
  const raw = await spawnSsh(argv, options.execTimeoutMs, stdin);
  const framed = parseFramed(raw.stderr, nonce);
  if (framed === undefined) {
    // ⛔ The command may or may not have run. Saying "absent" here is how a dropped link becomes a
    //   deleted config, so it is an error with ssh's own words (truncated, never the stdout).
    throw new Error(
      `ssh ${options.host}: the remote command did not report a status (ssh exit ` +
        `${String(raw.exitCode)}${raw.signal === null ? '' : `, killed by ${raw.signal}`}): ` +
        `${raw.stderr.trim().slice(0, 300)}`,
    );
  }
  return { exitCode: framed.exitCode, stderr: framed.stderr, stdout: raw.stdout };
};

const decodeBase64 = (text: string): Uint8Array =>
  new Uint8Array(Buffer.from(text.replaceAll('\n', ''), 'base64'));

const failed = (host: string, what: string, result: ExecResult): Error =>
  new Error(
    `ssh ${host}: ${what} -> ${String(result.exitCode)}: ${result.stderr.trim().slice(0, 300)}`,
  );

/**
 * Connect once to learn who we are, then hand back the runner.
 * ⛔ THE PROBE IS THE FAIL-CLOSED GATE. `effectiveUid()` is synchronous on HostRunner, so the uid
 *   must be known before the first provider call; and `uname -s` refuses a host whose `stat -c`,
 *   `base64` and `mv -f` are not the Linux spellings this runner sends. A host that cannot answer
 *   both is a thrown Error at construction, not a stack that half-deploys.
 */
export const sshRunner = async (options: SshRunnerOptions): Promise<HostRunner> => {
  const settings = {
    connectTimeoutSec: options.connectTimeoutSec ?? 10,
    execTimeoutMs: options.execTimeoutMs ?? 120_000,
    host: options.host,
    ...(options.sshArgs === undefined ? {} : { sshArgs: options.sshArgs }),
  };
  const nonce = randomBytes(8).toString('hex');
  const run = (script: string, stdin?: Uint8Array) => runRemote(settings, nonce, script, stdin);
  const probe = await run('uname -s; id -u');
  if (probe.exitCode !== 0) throw failed(options.host, 'uname -s; id -u', probe);
  const [system, uid] = probe.stdout.trim().split('\n');
  if (system !== 'Linux' || uid === undefined || !/^\d+$/.test(uid)) {
    throw new Error(
      `ssh ${options.host}: expected a Linux host, got ${JSON.stringify(probe.stdout.trim())}. ` +
        'sshRunner() sends GNU/BusyBox argv (stat -c, base64, mv -f); for a Mac use localRunner().',
    );
  }
  const euid = Number(uid);
  return {
    effectiveUid: () => euid,
    exec: (argv) => run(execScript(argv)),
    lookupGroup: async (nameOrId) => {
      const result = await run(execScript(groupQuery('linux', nameOrId)));
      return result.exitCode === 0 ? parseGroup('linux', result.stdout) : undefined;
    },
    lookupUser: async (nameOrId) => {
      const result = await run(execScript(userQuery('linux', nameOrId)));
      return result.exitCode === 0 ? parseUser('linux', result.stdout) : undefined;
    },
    privileged: false,
    readFile: async (path) => {
      const result = await run(readScript(path));
      if (result.exitCode === ABSENT) return undefined;
      if (result.exitCode !== 0) throw failed(options.host, `read ${path}`, result);
      return decodeBase64(result.stdout);
    },
    removeFile: async (path) => {
      const result = await run(removeScript(path));
      if (result.exitCode !== 0) throw failed(options.host, `remove ${path}`, result);
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    stat: async (path) => {
      const result = await run(statScript(path));
      if (result.exitCode === ABSENT) return undefined;
      if (result.exitCode !== 0) throw failed(options.host, `stat ${path}`, result);
      const parsed = parseStat(result.stdout);
      // ⛔ Unparseable is an error, not "nothing there": a `stat` that printed something we do not
      //   understand is a host this runner does not know, and guessing would write over a file.
      if (parsed === undefined) {
        throw new Error(`ssh ${options.host}: stat ${path} printed an unexpected shape`);
      }
      return parsed;
    },
    writeFileAtomic: async (path, bytes, write) => {
      const at = path.lastIndexOf('/');
      const temp = `${path.slice(0, at)}/.${path.slice(at + 1)}.${randomBytes(6).toString('hex')}.tmp`;
      const result = await run(writeScript(path, temp, write), bytes);
      if (result.exitCode !== 0) throw failed(options.host, `write ${path}`, result);
    },
  };
};
