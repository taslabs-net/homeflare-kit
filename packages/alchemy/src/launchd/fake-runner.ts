/**
 * An in-memory host for the tests beside it: a filesystem in a Map and a scripted launchd.
 *
 * ⛔ TEST-ONLY. No provider imports this file, it is not on the barrel, and it never touches the
 *   real filesystem or runs a real program — which is the only way the lifecycle tests can prove
 *   "bootout before bootstrap" without writing /Library or loading a job.
 * ★ IT MODELS THE BEHAVIOURS THE PROVIDER DEPENDS ON, as launchctl.ts documents them: `print` of an
 *   unknown target exits 113; bootstrap of a loaded or disabled label fails; bootout of an absent
 *   job exits non-zero; a job can linger after bootout (`lingerPrints`); a gui uid with no login
 *   session answers 112 (`loggedOut`); writes into a root-owned directory, or a chown to another
 *   uid, need root.
 * ★ Every directory ABOVE a declared one exists, root's and `0755`, as `/`, `/Library` and `/opt`
 *   are on a Mac; `acls` holds the `ls -lden` entry lines a directory prints (sudo-acl.ts).
 */
import { LAUNCHCTL, NOT_FOUND, NO_DOMAIN } from './launchctl.ts';
import type { ExecResult, FileStat, HostRunner, HostUser, WriteOptions } from './runner.ts';

type Entry = { bytes: Uint8Array; mode: number; uid: number; gid: number; kind: FileStat['kind'] };

export type FakeOptions = {
  euid?: number;
  privileged?: boolean;
  /** Directories that exist, and their owner uid. */
  dirs?: Record<string, number>;
  users?: Record<string, HostUser>;
  groups?: Record<string, number>;
};

const ok = (stdout = ''): ExecResult => ({ exitCode: 0, stderr: '', stdout });
const fail = (exitCode: number, stderr: string): ExecResult => ({ exitCode, stderr, stdout: '' });
const errno = (code: string, path: string) =>
  Object.assign(new Error(`${code}: ${path}`), { code });
const parent = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';

/** The shape `launchctl print` produced on macOS 27.2 (see launchctl.ts), trimmed. */
const printBlock = (target: string, pid: number | undefined, lastExit: string) =>
  [
    `${target} = {`,
    '\tactive count = 1',
    `\tstate = ${pid === undefined ? 'not running' : 'running'}`,
    '\targuments = {',
    '\t\t/bin/sh',
    '}',
    '\t}',
    '\tresource coalition = {',
    '\t\tstate = active',
    '\t}',
    ...(pid === undefined ? [] : [`\tpid = ${String(pid)}`]),
    `\tlast exit code = ${lastExit}`,
    '}',
  ].join('\n');

export const fakeRunner = (options: FakeOptions = {}) => {
  const euid = options.euid ?? 501;
  const privileged = options.privileged ?? false;
  const root = privileged || euid === 0;
  const dirs = new Map(Object.entries(options.dirs ?? {}));
  const files = new Map<string, Entry>();
  /** Directory → the ACL entry lines `ls -lden` prints under it. */
  const acls = new Map<string, string[]>();
  /** The directories above the declared ones, as the host starts: root's, `0755`. */
  const above = new Set<string>(['/']);
  for (const dir of dirs.keys()) {
    const parts = dir.split('/').slice(1, -1);
    for (const index of parts.keys()) above.add(`/${parts.slice(0, index + 1).join('/')}`);
  }
  for (const dir of dirs.keys()) above.delete(dir);
  const implied = (path: string) => above.has(path);
  const calls: string[][] = [];
  /** target → pid (undefined = loaded, not running). */
  const loaded = new Map<string, number | undefined>();
  const disabled = new Set<string>();
  const state = {
    lingerPrints: 0,
    nextPid: 4000,
    bootstrapFailure: undefined as ExecResult | undefined,
    /** Returned by bootout in place of success. The job still goes, unless `bootoutKeepsJob`. */
    bootoutFailure: undefined as ExecResult | undefined,
    bootoutKeepsJob: false,
    /** gui uids with no login session: every launchctl call into `gui/<uid>` exits 112. */
    loggedOut: new Set<number>(),
  };
  /** Booted-out targets launchd has not let go of yet → prints left before they vanish. */
  const lingering = new Map<string, number>();

  const labelIn = (path: string) =>
    /<key>Label<\/key>\s*<string>([^<]*)<\/string>/.exec(
      new TextDecoder().decode(files.get(path)?.bytes),
    )?.[1];

  const launchctl = (args: readonly string[]): ExecResult => {
    const [sub, first, second] = args;
    const gui = /^gui\/(\d+)(?:\/|$)/.exec(first ?? '')?.[1];
    if (gui !== undefined && state.loggedOut.has(Number(gui))) {
      // The measured shape (launchctl.ts): 112, "Bad request." then the domain line.
      return fail(NO_DOMAIN, `Bad request.\nCould not find domain for user gui: ${gui}`);
    }
    if (sub === 'print' && first !== undefined) {
      const left = lingering.get(first);
      if (left !== undefined) {
        if (left <= 0) {
          lingering.delete(first);
          loaded.delete(first);
        } else lingering.set(first, left - 1);
      }
      if (!loaded.has(first)) return fail(NOT_FOUND, `Could not find service "${first}"`);
      return ok(printBlock(first, loaded.get(first), '(never exited)'));
    }
    if (sub === 'print-disabled' && first !== undefined) {
      const lines = [...disabled]
        .filter((target) => target.startsWith(`${first}/`))
        .map((target) => `\t\t"${target.slice(first.length + 1)}" => disabled`);
      return ok(['\tdisabled services = {', ...lines, '\t}'].join('\n'));
    }
    if (sub === 'bootstrap' && first !== undefined && second !== undefined) {
      if (state.bootstrapFailure !== undefined) return state.bootstrapFailure;
      const label = labelIn(second);
      if (label === undefined) return fail(5, 'Bootstrap failed: 5: Input/output error');
      const target = `${first}/${label}`;
      if (loaded.has(target) || disabled.has(target))
        return fail(5, 'Bootstrap failed: 5: Input/output error');
      state.nextPid += 1;
      loaded.set(target, state.nextPid);
      return ok();
    }
    if (sub === 'bootout' && first !== undefined) {
      if (!loaded.has(first) || lingering.has(first))
        return fail(3, 'Boot-out failed: 3: No such process');
      if (state.bootoutKeepsJob) return state.bootoutFailure ?? fail(5, 'Boot-out failed: 5');
      // ⚠️ Model launchd letting go late: the job stays visible for `lingerPrints` more prints.
      if (state.lingerPrints === 0) loaded.delete(first);
      else lingering.set(first, state.lingerPrints);
      return state.bootoutFailure ?? ok();
    }
    return fail(64, `fake launchctl: unsupported ${args.join(' ')}`);
  };

  const runner: HostRunner = {
    effectiveUid: () => euid,
    exec: async (argv) => {
      calls.push([...argv]);
      if (argv[0] === LAUNCHCTL) return launchctl(argv.slice(1));
      if (argv[0] === '/bin/ls' && argv[1] === '-lden' && argv[2] === '--') {
        const paths = argv.slice(3);
        if (paths.some((path) => !dirs.has(path) && !files.has(path) && !implied(path)))
          return fail(1, 'ls: No such file or directory');
        const lines = paths.flatMap((path) => [
          `drwxr-xr-x  2 0  0  64 Sep 21 10:00 ${path}`,
          ...(acls.get(path) ?? []),
        ]);
        return ok(lines.join('\n'));
      }
      return fail(127, `fake: no program ${String(argv[0])}`);
    },
    lookupGroup: async (nameOrId) => options.groups?.[nameOrId],
    lookupUser: async (nameOrId) =>
      options.users?.[nameOrId] ??
      Object.values(options.users ?? {}).find((user) => String(user.uid) === nameOrId),
    privileged,
    readFile: async (path) => files.get(path)?.bytes,
    removeFile: async (path) => {
      if (files.has(path) && (dirs.get(parent(path)) ?? 0) !== euid && !root)
        throw errno('EACCES', path);
      files.delete(path);
    },
    // ★ No real waiting: a lingering job drains one `print` per poll instead.
    sleep: async () => undefined,
    stat: async (path) => {
      const entry = files.get(path);
      if (entry !== undefined)
        return {
          gid: entry.gid,
          kind: entry.kind,
          mode: entry.mode,
          size: entry.bytes.length,
          uid: entry.uid,
        };
      if (dirs.has(path) || implied(path))
        return { gid: 0, kind: 'directory', mode: 0o755, size: 0, uid: dirs.get(path) ?? 0 };
      return undefined;
    },
    writeFileAtomic: async (path: string, bytes: Uint8Array, write: WriteOptions) => {
      calls.push(['write', path]);
      const owner = dirs.get(parent(path));
      if (owner === undefined) throw errno('ENOENT', parent(path));
      if (owner !== euid && !root) throw errno('EACCES', path);
      if (write.uid !== undefined && write.uid !== euid && !root) throw errno('EPERM', path);
      files.set(path, {
        bytes,
        gid: write.gid ?? 20,
        kind: 'file',
        mode: write.mode,
        uid: write.uid ?? euid,
      });
    },
  };
  return { acls, calls, disabled, dirs, files, loaded, runner, state };
};
