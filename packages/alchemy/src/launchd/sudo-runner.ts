/**
 * sudoRunner(): the kit's one elevating HostRunner. The deploy runs as the operator, and only the
 * calls that need root go through `sudo -n`, in the exact shapes sudo-allowlist.ts names:
 *
 * - `launchctl bootstrap | bootout | kickstart` in the system domain;
 * - a file under a prefix the stack declared: staged in a private temp file as the operator, then
 *   `sudo -n install -S -m <mode> [-o <uid>] [-g <gid>] <staged> <path>`; removed with
 *   `sudo -n rm -f -- <path>`.
 *
 * Everything else (reads, lookups, the operator's own files and gui domain) goes to localRunner().
 *
 * ★ DECIDED 2026-09-21. A host stack deploys as the operator rather than as root, so a provider bug
 *   or a wrong declaration can do no more than this list. It is an explicit opt-in,
 *   `launchdProviders(sudoRunner({ prefixes }))`, and nothing ever falls back to it: localRunner()
 *   stays the default and never elevates.
 * ⛔ `sudo -n`, NEVER A PROMPT. A deploy that stops mid-apply to ask for a password is the failure
 *   "no silent sudo" exists to prevent. With -n, sudo fails at once, and that failure becomes an
 *   error saying what to do.
 * ⛔ EVERY PRIVILEGED ARGV IS LOGGED BEFORE IT RUNS, and it is only ever an argv: a file's bytes
 *   travel through the staged file, never through argv, so a log line cannot carry content.
 * ★ `install -S`: install(1) on macOS 27.2 (read 2026-09-21) always writes a temp file in the
 *   target directory and renames it, so the file is never torn, and -S adds the fsync that
 *   localRunner's `handle.sync()` does.
 * ⚠️ BUT IT CHMODS AFTER THE RENAME. MEASURED 2026-09-22 (an lstat poller racing
 *   `/usr/bin/install -S -m 0755`, 300 MB, six runs, target absent and present): the new inode
 *   is visible at the path as 0600, then 0755 0.2–0.4 ms later. Only ever narrower than declared.
 *   ⚠️ REASONED NOT MEASURED: a launchd start inside that window gets EACCES and retries after its
 *   throttle, and an install killed inside it leaves a root-owned 0600 file the operator cannot
 *   read back. Closing it needs a second privileged step (install to a temp name, then rename),
 *   which is a change to this allowlist and wants its own red team.
 * ⚠️ AND IT COPIES XATTRS, com.apple.quarantine included (MEASURED 2026-09-22: a quarantined
 *   source installed as a quarantined target). The staged file is written by this process, and
 *   node:fs writes here carried only com.apple.provenance (measured the same day) — so nothing
 *   is quarantined today, but a quarantined staging file would be installed quarantined.
 * ⚠️ REASONED, NOT MEASURED: sudo's failure text (sudo-said.ts has the strings and their sources).
 * ⛔ EVERY CHECK BEFORE SUDO ALSO RUNS AT PLAN TIME (`checkWrite`, 2026-09-21): the mode, the
 *   directories from the prefix down, the read-back. Reads only, as the operator — never sudo.
 */
import { type LocalRunnerOptions, localRunner } from './local-runner.ts';
import type { ExecResult, HostRunner, WriteOptions } from './runner.ts';
import {
  INSTALL,
  RM,
  SUDO,
  SudoRefusedError,
  checkPrefixes,
  octalMode,
  prefixOf,
  privilegedProblem,
  routeExec,
} from './sudo-allowlist.ts';
import { assertInstallable, assertPlainPath, operatorGroups } from './sudo-guard.ts';
import { sudoRefusal, undeclared } from './sudo-said.ts';
import { type Staged, stageFile } from './sudo-stage.ts';

export { SudoRefusedError };

export type SudoRunnerOptions = LocalRunnerOptions & {
  /**
   * The directories root may install into and remove from: `/Library/LaunchDaemons` for system
   * jobs (bootstrap and bootout are refused without it), plus wherever the stack's root-owned
   * HostFiles live. ⛔ Required: absolute, normalised, never `/`; and at every privileged call a
   * real directory that root owns and only root may write (sudo-guard.ts). Outside every prefix a
   * file is written as the deploying user, or refused when that needs root.
   */
  readonly prefixes: readonly string[];
  /** Receives one line per privileged argv, before it runs. @default a line on stderr */
  readonly log?: (line: string) => void;
};

/** What a sudo runner is built from. ★ Split out so the tests swap the host, never the logic. */
export type SudoDeps = {
  /** Runs everything, including `sudo` itself. localRunner() for the real one. */
  readonly base: HostRunner;
  readonly stage: (bytes: Uint8Array) => Promise<Staged>;
  /** The deploying user's groups, for the read-back check; `undefined` when unknown. */
  readonly groups: () => Promise<readonly number[] | undefined>;
  readonly log: (line: string) => void;
};

export const makeSudoRunner = (prefixList: readonly string[], deps: SudoDeps): HostRunner => {
  const prefixes = checkPrefixes(prefixList);
  const { base } = deps;

  /**
   * ⛔ THE ONE PLACE `sudo` IS SPAWNED: allowlist, then any host check (`before`), then the log
   *   line, then `sudo -n -- argv`.
   */
  const elevate = async (
    argv: readonly string[],
    { before, staged }: { before?: () => Promise<unknown>; staged?: string } = {},
  ): Promise<ExecResult> => {
    const shown = JSON.stringify(argv);
    const problem = privilegedProblem(argv, {
      prefixes,
      ...(staged === undefined ? {} : { staged }),
    });
    if (problem !== undefined)
      throw new SudoRefusedError(`sudoRunner refused ${shown}: ${problem}`);
    await before?.();
    deps.log(`homeflare/launchd sudo -n ${shown}`);
    const result = await base.exec([SUDO, '-n', '--', ...argv]);
    const refused = sudoRefusal(shown, result);
    if (refused !== undefined) throw refused;
    return result;
  };

  /**
   * Every refusal a write can meet before sudo is asked — as the deploying user, reading only — so
   * the same checks run at plan time (`checkWrite`) and at the write. `undefined` outside every
   * prefix, where the operator writes; else the prefix and the mode as `install -m` takes it.
   */
  const vetWrite = async (path: string, options: WriteOptions) => {
    const prefix = prefixOf(path, prefixes);
    const operator = base.effectiveUid();
    if (prefix === undefined) {
      if (options.uid !== undefined && options.uid !== operator && operator !== 0) {
        throw new SudoRefusedError(
          `sudoRunner ${path}: owner ${String(options.uid)} needs root, and the path is under no ` +
            `declared prefix (${prefixes.join(', ')}). Declare its directory, or deploy as root. ` +
            'Nothing was written.',
        );
      }
      return undefined;
    }
    const mode = octalMode(options.mode);
    if (mode === undefined) throw new SudoRefusedError(`sudoRunner ${path}: mode must be 0–0o7777`);
    await assertInstallable(base, prefix, path, options, await deps.groups());
    return { mode, prefix };
  };

  /** A privileged file operation: anything but exit 0 is an error. ⚠️ stderr names paths only. */
  const mustSucceed = async (argv: readonly string[], staged?: string): Promise<void> => {
    const result = await elevate(argv, staged === undefined ? {} : { staged });
    if (result.exitCode !== 0) {
      const stderr = result.stderr.trim().slice(0, 300);
      throw new Error(`sudo -n ${JSON.stringify(argv)} -> ${String(result.exitCode)}: ${stderr}`);
    }
  };

  return {
    // ★ The plan-time half of vetWrite: the providers' diffs call it, and it never elevates.
    checkWrite: async (path, options) => {
      await vetWrite(path, options);
    },
    effectiveUid: () => base.effectiveUid(),
    exec: async (argv) => {
      const route = routeExec(argv, base.effectiveUid());
      if ('refuse' in route) throw new SudoRefusedError(`sudoRunner: ${route.refuse}`);
      if (route.as === 'operator') return base.exec(argv);
      // ⛔ bootstrap makes root read the plist: it must be a plain file exactly where argv says.
      //   The allowlist has already put it under a prefix by the time `before` runs.
      const plist = argv[1] === 'bootstrap' ? argv[3] : undefined;
      const prefix = plist === undefined ? undefined : prefixOf(plist, prefixes);
      return elevate(argv, {
        before: async () => {
          if (plist !== undefined && prefix !== undefined) {
            await assertPlainPath(base, prefix, plist, 'file');
          }
        },
      });
    },
    lookupGroup: (nameOrId) => base.lookupGroup(nameOrId),
    lookupUser: (nameOrId) => base.lookupUser(nameOrId),
    // ★ True, so the providers let a system-domain job through to this runner (canActAsRoot).
    privileged: true,
    readFile: (path) => base.readFile(path),
    removeFile: async (path) => {
      const prefix = prefixOf(path, prefixes);
      if (prefix === undefined) return base.removeFile(path).catch(undeclared(path, prefixes));
      /**
       * ★ Nothing there is success without a privileged call, so an idempotent delete logs nothing.
       * ⚠️ lstat the path FIRST: a directory on the way that is already gone means nothing is there
       *   (HostRunner.removeFile is idempotent, and localRunner treats ENOENT/ENOTDIR so), where the
       *   guard alone would refuse it as a missing directory.
       */
      if ((await base.stat(path)) === undefined) return;
      await assertPlainPath(base, prefix, path, 'file');
      await mustSucceed([RM, '-f', '--', path]);
    },
    sleep: (ms) => base.sleep(ms),
    stat: (path) => base.stat(path),
    writeFileAtomic: async (path, bytes, options) => {
      const vetted = await vetWrite(path, options);
      if (vetted === undefined) {
        return base.writeFileAtomic(path, bytes, options).catch(undeclared(path, prefixes));
      }
      const { mode } = vetted;
      const staged = await deps.stage(bytes);
      try {
        await mustSucceed(
          [
            INSTALL,
            '-S',
            '-m',
            mode,
            ...(options.uid === undefined ? [] : ['-o', String(options.uid)]),
            ...(options.gid === undefined ? [] : ['-g', String(options.gid)]),
            staged.path,
            path,
          ],
          staged.path,
        );
      } finally {
        await staged.dispose();
      }
    },
  };
};

/**
 * The real sudo runner: localRunner() for everything, `/usr/bin/sudo -n` for the allowlist.
 * Pass it explicitly: `launchdProviders(sudoRunner({ prefixes: ['/Library/LaunchDaemons'] }))`.
 */
export const sudoRunner = (options: SudoRunnerOptions): HostRunner => {
  const base = localRunner(options);
  return makeSudoRunner(options.prefixes, {
    base,
    groups: () => operatorGroups(base),
    log:
      options.log ??
      ((line) => {
        process.stderr.write(`${line}\n`);
      }),
    stage: stageFile,
  });
};
