/**
 * An in-memory Linux host for the tests beside it: a filesystem in a Map, the four directory
 * programs, and a systemd that behaves the way systemctl.ts measured the real one behaving.
 *
 * ⛔ TEST-ONLY. No provider imports this file, it is not on the barrel, and it never touches the
 *   real filesystem or runs a real program — which is the only way the lifecycle tests can prove
 *   "an adopted unit is not restarted" without stopping something on a live host.
 * ★ IT MODELS THE BEHAVIOURS THE PROVIDERS DEPEND ON: `show` of an unknown unit EXITS 0 with
 *   `LoadState=not-found`; `enable` fails for a unit file with no `[Install]`; `NeedDaemonReload`
 *   turns on when a unit file changes under systemd and off at `daemon-reload`; every call is
 *   recorded in order, so a test can assert that a restart did NOT happen.
 */
import { sha256Hex } from '../launchd/job-form.ts';
import { type UnitState, fakeSystemd } from './fake-systemd.ts';
import type {
  ExecResult,
  FileStat,
  HostRunner,
  HostUser,
  WriteOptions,
} from '../launchd/runner.ts';

type Entry = { bytes: Uint8Array; mode: number; uid: number; gid: number; kind: FileStat['kind'] };

export type FakeLinuxOptions = {
  euid?: number;
  privileged?: boolean;
  /** Directories that exist, and their owner uid. Every level above one of these exists as root. */
  dirs?: Record<string, number>;
  users?: Record<string, HostUser>;
  groups?: Record<string, number>;
  /** ⛔ Make every `systemctl show` fail, to prove a failed READ refuses instead of writing. */
  failShow?: boolean;
};

const ok = (stdout = ''): ExecResult => ({ exitCode: 0, stderr: '', stdout });
const fail = (exitCode: number, stderr: string): ExecResult => ({ exitCode, stderr, stdout: '' });
const errno = (code: string, path: string) =>
  Object.assign(new Error(`${code}: ${path}`), { code });
const parent = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';
const decode = (bytes: Uint8Array | undefined) =>
  bytes === undefined ? undefined : new TextDecoder().decode(bytes);

export const fakeLinuxHost = (options: FakeLinuxOptions = {}) => {
  const euid = options.euid ?? 0;
  const privileged = options.privileged ?? false;
  const root = privileged || euid === 0;
  const dirs = new Map(Object.entries(options.dirs ?? {}));
  const files = new Map<string, Entry>();
  const calls: string[][] = [];
  const units = new Map<string, UnitState>();
  const above = new Set<string>(['/']);
  for (const dir of dirs.keys()) {
    const parts = dir.split('/').slice(1, -1);
    for (const index of parts.keys()) above.add(`/${parts.slice(0, index + 1).join('/')}`);
  }
  for (const dir of dirs.keys()) above.delete(dir);
  const implied = (path: string) => above.has(path);
  /** Unit name → the path its file was last written at, so `show` can find it again. */
  const unitPaths = new Map<string, string>();
  /** Declared directories keep their own mode and owner; implied ones are root's 0755. */
  const modes = new Map<string, { mode: number; uid: number; gid: number }>();
  for (const [dir, owner] of dirs) modes.set(dir, { gid: 0, mode: 0o755, uid: owner });

  const digest = (text: string) => sha256Hex(new TextEncoder().encode(text));

  /** ★ The default unit directory needs no registration, exactly as it needs none on a real host. */
  const pathOf = (name: string) => unitPaths.get(name) ?? `/etc/systemd/system/${name}`;
  const fileFor = (name: string) => decode(files.get(pathOf(name))?.bytes);

  const systemctl = fakeSystemd({
    digest,
    failShow: options.failShow === true,
    fileAt: (path) => decode(files.get(path)?.bytes),
    fileFor,
    files,
    pathOf,
    units,
  });

  const directoryProgram = (argv: readonly string[]): ExecResult => {
    const [program, ...rest] = argv;
    const path = rest.at(-1) ?? '';
    if (program === 'mkdir') {
      const mode = rest[0] === '-m' ? Number.parseInt(rest[1] ?? '755', 8) : 0o755;
      if (!dirs.has(parent(path)) && !implied(parent(path))) {
        return fail(1, `mkdir: cannot create directory '${path}': No such file or directory`);
      }
      if (dirs.has(path) || implied(path)) return fail(1, `mkdir: '${path}': File exists`);
      dirs.set(path, euid);
      modes.set(path, { gid: 0, mode, uid: euid });
      return ok();
    }
    if (program === 'chmod' || program === 'chown') {
      const live = modes.get(path);
      if (!dirs.has(path) || live === undefined) return fail(1, `${String(program)}: ${path}`);
      if (program === 'chmod') live.mode = Number.parseInt(rest[0] ?? '755', 8);
      else {
        if (!root) return fail(1, `chown: ${path}: Operation not permitted`);
        const [uid, gid] = (rest[0] ?? '').split(':');
        if (uid !== undefined && uid !== '') live.uid = Number(uid);
        if (gid !== undefined && gid !== '') live.gid = Number(gid);
      }
      return ok();
    }
    if (program === 'rmdir') {
      if (!dirs.has(path)) return fail(1, `rmdir: '${path}': No such file or directory`);
      if ([...files.keys()].some((file) => parent(file) === path)) {
        return fail(1, `rmdir: failed to remove '${path}': Directory not empty`);
      }
      dirs.delete(path);
      modes.delete(path);
      return ok();
    }
    return fail(127, `fake: no program ${String(program)}`);
  };

  const runner: HostRunner = {
    effectiveUid: () => euid,
    exec: async (argv) => {
      calls.push([...argv]);
      if (argv[0] === 'systemctl') return systemctl(argv.slice(1).filter((arg) => arg !== '--'));
      if (argv[0] === 'getent') return fail(2, 'getent: not modelled');
      return directoryProgram(argv.filter((arg) => arg !== '--'));
    },
    lookupGroup: async (nameOrId) => options.groups?.[nameOrId],
    lookupUser: async (nameOrId) =>
      options.users?.[nameOrId] ??
      Object.values(options.users ?? {}).find((user) => String(user.uid) === nameOrId),
    privileged,
    readFile: async (path) => files.get(path)?.bytes,
    removeFile: async (path) => {
      if (files.has(path) && (dirs.get(parent(path)) ?? 0) !== euid && !root) {
        throw errno('EACCES', path);
      }
      files.delete(path);
    },
    sleep: async () => undefined,
    stat: async (path) => {
      const entry = files.get(path);
      if (entry !== undefined) {
        return {
          gid: entry.gid,
          kind: entry.kind,
          mode: entry.mode,
          size: entry.bytes.length,
          uid: entry.uid,
        };
      }
      const live = modes.get(path);
      if (live !== undefined) return { ...live, kind: 'directory', size: 0 };
      if (implied(path)) return { gid: 0, kind: 'directory', mode: 0o755, size: 0, uid: 0 };
      return undefined;
    },
    writeFileAtomic: async (path: string, bytes: Uint8Array, write: WriteOptions) => {
      calls.push(['write', path]);
      const owner = modes.get(parent(path))?.uid ?? (implied(parent(path)) ? 0 : undefined);
      if (owner === undefined) throw errno('ENOENT', parent(path));
      if (owner !== euid && !root) throw errno('EACCES', path);
      if (write.uid !== undefined && write.uid !== euid && !root) throw errno('EPERM', path);
      files.set(path, {
        bytes,
        gid: write.gid ?? 0,
        kind: 'file',
        mode: write.mode,
        uid: write.uid ?? euid,
      });
    },
  };

  /** Put a unit on the host the way a package or a person would, outside any declaration. */
  const placeUnit = (path: string, text: string, state: Partial<UnitState> = {}) => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    files.set(path, {
      bytes: new TextEncoder().encode(text),
      gid: 0,
      kind: 'file',
      mode: 0o644,
      uid: 0,
    });
    unitPaths.set(name, path);
    modes.set(path.slice(0, path.lastIndexOf('/')) || '/', { gid: 0, mode: 0o755, uid: 0 });
    units.set(name, {
      active: state.active ?? false,
      enabled: state.enabled ?? false,
      loadedSha: state.loadedSha === undefined ? digest(text) : state.loadedSha,
      ...(state.masked === undefined ? {} : { masked: state.masked }),
    });
  };

  /** Tell the fake systemd which file a unit name belongs to, before that file exists. */
  const expectUnit = (path: string) => {
    unitPaths.set(path.slice(path.lastIndexOf('/') + 1), path);
  };

  return { calls, dirs, expectUnit, files, modes, placeUnit, runner, units };
};
