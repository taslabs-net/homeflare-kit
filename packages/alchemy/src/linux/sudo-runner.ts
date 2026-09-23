/**
 * sshSudoRunner(): the Linux twin of `../launchd/sudo-runner.ts` — the same idea (the deploy runs
 * as the operator, and only a fixed allowlist of calls goes through `sudo -n`), rebuilt for a
 * non-root ssh user with passwordless sudo instead of a local macOS session. See
 * docs/linux-sudo.md for the full argv table and what is measured versus reasoned.
 *
 * ⛔ `sudo -n`, NEVER A PROMPT — same rule, same reason: a deploy that stops to ask for a password
 *   is the "no silent sudo" failure this exists to prevent.
 * ⛔ EVERY PRIVILEGED ARGV IS LOGGED BEFORE IT RUNS, and a file's bytes never reach argv or the
 *   log: they travel through the staged file (sudo-stage.ts) alone.
 * ⛔ A PLAN NEVER ELEVATES. `checkWrite` and every read run through `base` — the plain
 *   `sshRunner()` — never through sudo. Nothing here probes sudo at construction.
 * ★ PROMISES, NOT EFFECTS, ON PURPOSE — the same divergence `../launchd/runner.ts` documents
 *   (H3 in the provider-standard skill): a consumer's own runner is a plain async implementation.
 */
import type { HostRunner } from '../launchd/runner.ts';
import { sudoRefusal } from '../launchd/sudo-said.ts';
import { type SshRunnerOptions, sshRunner } from './ssh-runner.ts';
import { elevatedExec } from './sudo-exec.ts';
import {
  CHMOD,
  CHOWN,
  INSTALL,
  MKDIR,
  MV,
  RM,
  RMDIR,
  SUDO,
  SYSTEMCTL_ABS,
  SudoRefusedError,
  checkPrefixes,
  prefixOf,
  privilegedProblem,
  routeExec,
} from './sudo-allowlist.ts';
import { assertGuardedChain } from './sudo-guard.ts';
import { type Staged, stageRemote } from './sudo-stage.ts';
import { type Elevate, vetWrite, writeUnderPrefix } from './sudo-write.ts';

export { SudoRefusedError };

export type SshSudoRunnerOptions = SshRunnerOptions & {
  /** Directories root may write under. Required; absolute, normalised, never `/`. */
  readonly prefixes: readonly string[];
  /** One line per privileged argv, before it runs. @default a line on stderr */
  readonly log?: (line: string) => void;
};

/** What a sudo runner is built from. ★ Split out so the tests swap the host, never the logic. */
export type SshSudoDeps = {
  /** Runs everything, including `sudo` itself. `await sshRunner(options)` for the real one. */
  readonly base: HostRunner;
  readonly stage: (bytes: Uint8Array) => Promise<Staged>;
  readonly log: (line: string) => void;
};

const outsidePrefixHint =
  (path: string, prefixes: readonly string[]) =>
  (cause: unknown): never => {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (!/permission denied|operation not permitted/i.test(message)) throw cause;
    throw new Error(
      `sshSudoRunner ${path}: the operator could not do this, and the path is under no declared ` +
        `prefix (${prefixes.join(', ')}). If root owns its directory, declare that directory as ` +
        'a prefix.',
      { cause },
    );
  };

export const makeSshSudoRunner = (prefixList: readonly string[], deps: SshSudoDeps): HostRunner => {
  const prefixes = checkPrefixes(prefixList);
  const { base } = deps;

  /** ⛔ THE ONE PLACE `sudo` IS SPAWNED: allowlist, then any host check (`before`), then the log
   *    line, then `sudo -n -- argv`. Shared by exec()'s root branch and by writeFileAtomic. */
  const elevate: Elevate = async (argv, context, before) => {
    const shown = JSON.stringify(argv);
    const problem = privilegedProblem(argv, { prefixes, ...context });
    if (problem !== undefined)
      throw new SudoRefusedError(`sshSudoRunner refused ${shown}: ${problem}`);
    await before?.();
    deps.log(`homeflare/linux sudo -n ${shown}`);
    const result = await base.exec([SUDO, '-n', '--', ...argv]);
    const refused = sudoRefusal(shown, result);
    if (refused !== undefined) throw refused;
    return result;
  };

  return {
    checkWrite: async (path, options) => {
      await vetWrite(base, prefixes, path, options);
    },
    effectiveUid: () => base.effectiveUid(),
    exec: async (argv) => {
      const route = routeExec(argv, prefixes);
      if ('refuse' in route) throw new SudoRefusedError(`sshSudoRunner: ${route.refuse}`);
      if (route.as === 'operator') return base.exec(argv);
      return elevatedExec(base, elevate, prefixes, argv);
    },
    lookupGroup: (nameOrId) => base.lookupGroup(nameOrId),
    lookupUser: (nameOrId) => base.lookupUser(nameOrId),
    privileged: true,
    readFile: (path) => base.readFile(path),
    removeFile: async (path) => {
      const prefix = prefixOf(path, prefixes);
      if (prefix === undefined)
        return base.removeFile(path).catch(outsidePrefixHint(path, prefixes));
      // ★ Nothing there is success without a privileged call, so an idempotent delete logs nothing.
      const target = await assertGuardedChain(base, prefix, path, 'file-or-absent');
      if (target === undefined) return;
      const argv = [RM, '-f', '--', path];
      const result = await elevate(argv);
      if (result.exitCode !== 0) {
        throw new Error(
          `sudo -n ${JSON.stringify(argv)} -> ${String(result.exitCode)}: ${result.stderr.trim().slice(0, 300)}`,
        );
      }
    },
    sleep: (ms) => base.sleep(ms),
    stat: (path) => base.stat(path),
    writeFileAtomic: async (path, bytes, options) => {
      const vetted = await vetWrite(base, prefixes, path, options);
      if (vetted === undefined) {
        return base.writeFileAtomic(path, bytes, options).catch(outsidePrefixHint(path, prefixes));
      }
      await writeUnderPrefix(base, elevate, deps.stage, path, bytes, options, vetted.mode);
    },
  };
};

const REQUIRED_PROGRAMS = [SUDO, INSTALL, MV, RM, MKDIR, CHMOD, CHOWN, RMDIR, SYSTEMCTL_ABS];

/**
 * ★ READ-ONLY, OPTIONAL. One combined `test -x` so a missing coreutils package or a systemd-free
 *   container fails at construction with a clear message, instead of at the first deploy step
 *   that happens to need it. Never probes sudo itself.
 */
const checkProgramsExist = async (base: HostRunner, host: string): Promise<void> => {
  const script = REQUIRED_PROGRAMS.map(
    (p) => `test -x '${p}' || { echo "$0: ${p}"; exit 1; }`,
  ).join(' && ');
  const result = await base.exec(['/bin/sh', '-c', script, 'sshSudoRunner']);
  if (result.exitCode !== 0) {
    throw new Error(
      `sshSudoRunner ${host}: ${result.stdout.trim() || result.stderr.trim()} is missing or not ` +
        'executable on this host. sshSudoRunner sends absolute GNU coreutils and systemd paths.',
    );
  }
};

/** The real sudo runner: `sshRunner()` for everything, `/usr/bin/sudo -n` for the allowlist. */
export const sshSudoRunner = async (options: SshSudoRunnerOptions): Promise<HostRunner> => {
  const base = await sshRunner(options);
  await checkProgramsExist(base, options.host);
  return makeSshSudoRunner(options.prefixes, {
    base,
    log:
      options.log ??
      ((line) => {
        process.stderr.write(`${line}\n`);
      }),
    stage: stageRemote(base),
  });
};
