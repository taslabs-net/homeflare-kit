/**
 * sshSudoRunner over fake-linux-host.ts, for the tests beside it: the operator is uid 1000 and
 * unprivileged, and `/usr/bin/sudo` is a tiny interpreter (fake-sudo-root.ts) that runs the
 * allowlisted programs against the SAME in-memory host, as root. No test anywhere runs ssh or a
 * real sudo.
 *
 * ⛔ TEST-ONLY, like fake-linux-host.ts: no provider imports it, it is not on the barrel.
 * ★ `ls -ldn` AND `mktemp -d` ARE MODELLED HERE, AS THE OPERATOR — sudo-guard.ts's chain read and
 *   sudo-stage.ts's staging both run unprivileged, so both need a host that answers them without
 *   sudo. `ls` reads through `fake.runner.stat()` (already correct for declared dirs, their
 *   implied root-owned ancestors, and files) and formats one `ls -ldn`-shaped line per path;
 *   `mktemp -d` registers a fresh 0700 directory the operator owns.
 * ★ SUDO REFUSES A CALL THAT WAS NOT LOGGED FIRST, so every test holds the runner to "logged
 *   before it runs", exactly as the Mac fake does.
 * ★ `hostFactory`/`prefixes` (below) let sudo-lifecycle.test.ts drive `fakeQuadletHost` (not just
 *   the plain `fakeLinuxHost`) through this SAME elevation wiring, for the Podman.Container-through
 *   -sshSudoRunner regression tests — `fakeQuadletHost` returns the exact shape `fakeLinuxHost`
 *   does (`FakeLinuxOptions` in, the same fields out), so every handler below that reads
 *   `fake.dirs`/`fake.modes`/`fake.files` or calls `fake.runner.exec` works unchanged either way.
 */
import type { ExecResult, FileStat, HostRunner } from '../launchd/runner.ts';
import { SUDO_SAYS } from '../launchd/fake-sudo.ts';
import { type FakeLinuxOptions, fakeLinuxHost } from './fake-linux-host.ts';
import { type RootState, asRoot } from './fake-sudo-root.ts';
import { SUDO } from './sudo-allowlist.ts';
import { makeSshSudoRunner } from './sudo-runner.ts';
import { stageRemote } from './sudo-stage.ts';

export { SUDO_SAYS } from '../launchd/fake-sudo.ts';

export const OPERATOR = 1000;
export const PREFIXES = ['/etc/systemd/system', '/usr/local/bin'];

const ok = (stdout = ''): ExecResult => ({ exitCode: 0, stderr: '', stdout });
const fail = (exitCode: number, stderr: string): ExecResult => ({ exitCode, stderr, stdout: '' });

const permString = (mode: number): string => {
  const triplet = (shift: number, special: number, ch: string, upper: string) => {
    const r = (mode & (0o4 << shift)) === 0 ? '-' : 'r';
    const w = (mode & (0o2 << shift)) === 0 ? '-' : 'w';
    const exec = (mode & (0o1 << shift)) !== 0;
    const marked = (mode & special) !== 0;
    return `${r}${w}${marked ? (exec ? ch : upper) : exec ? 'x' : '-'}`;
  };
  return `${triplet(6, 0o4000, 's', 'S')}${triplet(3, 0o2000, 's', 'S')}${triplet(0, 0o1000, 't', 'T')}`;
};

const lsLine = (path: string, stat: FileStat, acl: boolean): string => {
  const kind = stat.kind === 'directory' ? 'd' : stat.kind === 'symlink' ? 'l' : '-';
  const target = stat.kind === 'symlink' ? ` -> ${path}.target` : '';
  return (
    `${kind}${permString(stat.mode)}${acl ? '+' : ''} 1 ${String(stat.uid)} ${String(stat.gid)} ` +
    `${String(stat.size)} Sep 22 10:12 ${path}${target}`
  );
};

export type FakeSudoHostOptions = {
  /** Swap `fakeLinuxHost` for a variant that models more than plain units — `fakeQuadletHost`. */
  readonly hostFactory?: (options: FakeLinuxOptions) => ReturnType<typeof fakeLinuxHost>;
  /** The runner's own declared prefixes. @default PREFIXES */
  readonly prefixes?: readonly string[];
};

/**
 * `extraDirs` adds more directories to the fake filesystem (a pre-existing tree outside every
 * prefix, say); it never changes the runner's OWN prefixes, which default to `PREFIXES`.
 * `acl` is the set of directory paths a test wants to carry the `+` (POSIX ACL) flag.
 */
export const fakeSudoHost = (
  extraDirs: Record<string, number> = {},
  acl: ReadonlySet<string> = new Set(),
  { hostFactory = fakeLinuxHost, prefixes = PREFIXES }: FakeSudoHostOptions = {},
) => {
  const dirs: Record<string, number> = {};
  for (const prefix of prefixes) dirs[prefix] = 0;
  for (const [path, owner] of Object.entries(extraDirs)) dirs[path] = owner;
  const fake = hostFactory({
    dirs,
    euid: OPERATOR,
    users: { app: { gid: 60, home: '/opt/app', uid: 900 } },
  });
  let mktempCount = 0;
  const logs: string[] = [];
  const sudoCalls: string[][] = [];
  const state: RootState & { sudo: 'ok' | keyof typeof SUDO_SAYS } = { sudo: 'ok' };

  const handleLs = async (paths: readonly string[]): Promise<ExecResult> => {
    const lines: string[] = [];
    for (const path of paths) {
      const stat = await fake.runner.stat(path);
      if (stat === undefined)
        return fail(2, `ls: cannot access '${path}': No such file or directory`);
      lines.push(lsLine(path, stat, acl.has(path)));
    }
    return ok(`${lines.join('\n')}\n`);
  };

  const handleMktemp = (): ExecResult => {
    mktempCount += 1;
    const dir = `/tmp/hf-sudo-${String(mktempCount)}`;
    fake.dirs.set(dir, OPERATOR);
    fake.modes.set(dir, { gid: 0, mode: 0o700, uid: OPERATOR });
    return ok(`${dir}\n`);
  };

  /** `rm -rf -- <dir>`, as the operator — `sudo-stage.ts`'s own cleanup of its staging directory. */
  const handleRm = (argv: readonly string[]): ExecResult => {
    const target = argv.at(-1);
    if (target === undefined) return fail(1, 'rm: missing operand');
    const under = (path: string) => path === target || path.startsWith(`${target}/`);
    for (const path of [...fake.files.keys()].filter(under)) fake.files.delete(path);
    for (const path of [...fake.dirs.keys()].filter(under)) {
      fake.dirs.delete(path);
      fake.modes.delete(path);
    }
    return ok();
  };

  const base: HostRunner = {
    ...fake.runner,
    exec: async (argv) => {
      // ★ Read-only, operator-level calls now go by absolute path too (cosmetic hardening from
      //   the 2026-09-23 adversarial review — see the sources' own headers); fakeLinuxHost's own
      //   dispatcher only recognises the bare names it was built against, so both spellings are
      //   handled here and `systemctl`'s absolute form is translated back to bare before it is
      //   handed off, rather than teaching the shared fixture a second spelling.
      if (argv[0] === 'ls' || argv[0] === '/usr/bin/ls') {
        if (argv[1] === '-ldn') return handleLs(argv.slice(3));
      }
      if ((argv[0] === 'mktemp' || argv[0] === '/usr/bin/mktemp') && argv[1] === '-d') {
        return handleMktemp();
      }
      if (argv[0] === 'rm' || argv[0] === '/usr/bin/rm') return handleRm(argv);
      if (argv[0] === '/usr/bin/systemctl')
        return fake.runner.exec(['systemctl', ...argv.slice(1)]);
      if (argv[0] !== SUDO) return fake.runner.exec(argv);
      sudoCalls.push([...argv]);
      if (logs[logs.length - 1] !== `homeflare/linux sudo -n ${JSON.stringify(argv.slice(3))}`) {
        throw new Error(`fake sudo: ${JSON.stringify(argv)} was not logged before it ran`);
      }
      if (state.sudo !== 'ok') return fail(1, SUDO_SAYS[state.sudo]);
      return asRoot(fake, argv.slice(3), state);
    },
  };

  const runner = makeSshSudoRunner(prefixes, {
    base,
    log: (line) => logs.push(line),
    // ★ The real stager, unmodified: it only ever calls `base.exec`/`base.writeFileAtomic`, both
    //   of which this fake's `mktemp`/`ls`/operator-level paths already answer.
    stage: stageRemote(base),
  });
  /** The privileged commands run, without the `sudo -n --` in front. */
  const privileged = () => sudoCalls.map((call) => call.slice(3));
  // ★ `base` (unprivileged, but with `ls`/`mktemp` support) is exposed for sudo-guard.test.ts,
  //   which exercises assertGuardedChain directly, below the runner it is a building block of.
  return { base, fake, logs, privileged, runner, state };
};
