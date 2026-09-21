/**
 * A sudo runner over fake-runner.ts, for the tests beside it: the deploying user is uid 501 and
 * unprivileged, and `/usr/bin/sudo` is a tiny interpreter that runs the three allowlisted programs
 * against the same in-memory host, as root.
 *
 * ⛔ TEST-ONLY, like fake-runner.ts: no provider imports it, it is not on the barrel, and it never
 *   runs a real program. No test anywhere runs a real sudo.
 * ★ THE INTERPRETER READS ONLY WHAT THE ARGV SAYS — mode, owner, group, source, destination — so a
 *   runner that dropped `-o` or wrote the wrong path shows up as the wrong file, not a passing test.
 * ★ THE BASE STAYS UNPRIVILEGED, so a write under /Library/LaunchDaemons that skipped sudo fails
 *   with the fake's EACCES instead of quietly succeeding.
 */
import { fakeRunner } from './fake-runner.ts';
import { LAUNCHCTL } from './launchctl.ts';
import type { ExecResult, HostRunner } from './runner.ts';
import { INSTALL, RM, SUDO } from './sudo-allowlist.ts';
import { makeSudoRunner } from './sudo-runner.ts';

export const OPERATOR = 501;
export const PREFIXES = ['/Library/LaunchDaemons', '/opt/example'];

const ok: ExecResult = { exitCode: 0, stderr: '', stdout: '' };
const fail = (exitCode: number, stderr: string): ExecResult => ({ exitCode, stderr, stdout: '' });

/** Parse `install -S -m MODE [-o UID] [-g GID] SRC DEST` the way install(1) would. */
const parseInstall = (args: readonly string[]) => {
  const mode = Number.parseInt(args[2] ?? '', 8);
  const rest = args.slice(3);
  const flag = (name: string) => {
    const at = rest.indexOf(name);
    return at === -1 ? undefined : Number(rest[at + 1]);
  };
  return {
    dest: rest[rest.length - 1] ?? '',
    gid: flag('-g'),
    mode,
    source: rest[rest.length - 2] ?? '',
    uid: flag('-o'),
  };
};

/** `groups` is the operator's `id -G`; `'unknown'` models that lookup failing. */
export const fakeSudoHost = (groups: readonly number[] | 'unknown' = [20, 80]) => {
  const fake = fakeRunner({
    dirs: {
      '/Library/LaunchDaemons': 0,
      '/opt/example': 0,
      '/opt/example/app': 0,
      '/Users/someone/Library/LaunchAgents': OPERATOR,
      '/Users/other/Library/LaunchAgents': 502,
      // Root-owned, and deliberately NOT a prefix: the forgotten-prefix case.
      '/etc/example': 0,
    },
    euid: OPERATOR,
    users: {
      other: { gid: 20, home: '/Users/other', uid: 502 },
      someone: { gid: 20, home: '/Users/someone', uid: OPERATOR },
    },
  });
  const staged = new Map<string, Uint8Array>();
  const logs: string[] = [];
  const sudoCalls: string[][] = [];
  const state = {
    /** What sudo itself answers: runs the command, wants a password, or is not allowed. */
    sudo: 'ok' as 'ok' | 'password' | 'denied',
    /** Returned by `install` in place of success; nothing is written. */
    installFailure: undefined as ExecResult | undefined,
    stagedCount: 0,
    /** The staged bytes as `install` saw them, by destination. */
    installedFrom: new Map<string, string>(),
  };

  const asRoot = async (argv: readonly string[]): Promise<ExecResult> => {
    const [program, ...args] = argv;
    if (program === LAUNCHCTL) return fake.runner.exec(argv);
    if (program === INSTALL) {
      if (state.installFailure !== undefined) return state.installFailure;
      const { dest, gid, mode, source, uid } = parseInstall(args);
      const bytes = staged.get(source);
      if (bytes === undefined) return fail(71, `install: ${source}: No such file or directory`);
      state.installedFrom.set(dest, new TextDecoder().decode(bytes));
      fake.files.set(dest, { bytes, gid: gid ?? 0, kind: 'file', mode, uid: uid ?? 0 });
      return ok;
    }
    if (program === RM) {
      fake.files.delete(args[2] ?? '');
      return ok;
    }
    return fail(1, `sudo: ${String(program)}: command not found`);
  };

  const base: HostRunner = {
    ...fake.runner,
    exec: async (argv) => {
      if (argv[0] !== SUDO) return fake.runner.exec(argv);
      sudoCalls.push([...argv]);
      if (state.sudo === 'password') return fail(1, 'sudo: a password is required\n');
      if (state.sudo === 'denied') {
        return fail(1, 'Sorry, user someone is not allowed to execute this as root on example.\n');
      }
      // argv is [sudo, -n, --, ...command]
      return asRoot(argv.slice(3));
    },
  };

  const runner = makeSudoRunner(PREFIXES, {
    base,
    groups: async () => (groups === 'unknown' ? undefined : groups),
    log: (line) => logs.push(line),
    stage: async (bytes) => {
      state.stagedCount += 1;
      const path = `/private/tmp/hf-sudo-${String(state.stagedCount)}/staged`;
      staged.set(path, bytes);
      return { dispose: async () => void staged.delete(path), path };
    },
  });
  /** The privileged commands run, without the `sudo -n --` in front. */
  const privileged = () => sudoCalls.map((call) => call.slice(3));
  return { fake, logs, privileged, runner, staged, state, sudoCalls };
};
