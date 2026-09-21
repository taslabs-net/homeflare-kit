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
 * ⚠️ REASONED, NOT MEASURED: sudo's failure text. The kit never runs sudo. The strings below follow
 *   sudoers(5) for sudo 1.9.17p2 on macOS 27.2 ("a password is required": -n was given but a
 *   password was needed) and sudo(8) (sudo exits 1 when it fails itself).
 */
import { type LocalRunnerOptions, errnoCode, localRunner } from './local-runner.ts';
import type { ExecResult, HostRunner } from './runner.ts';
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
import { assertPlainPath, assertReadableBack, operatorGroups } from './sudo-guard.ts';
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

/**
 * ⚠️ ANCHORED TO sudo'S OWN MESSAGE FORMS (`sudo: …` lines, `Sorry, user …`), so a launchctl or
 *   install error that happens to say "not allowed" is never reported as "the command did not run".
 *   The refusals are the three a sudoers denial prints: the command not allowed, the user not in
 *   sudoers, and the user not allowed on this host (`<user> is not allowed to run sudo on <host>.`).
 *   REASONED from sudo 1.9's sudoers plugin, like the rest (header).
 */
const PASSWORD =
  /^sudo: (?:a password is required|a terminal is required|sorry, you must have a tty)/m;
const NOT_ALLOWED =
  /^(?:Sorry, user \S+ (?:is not allowed to execute|may not run sudo)|\S+ is not (?:in the sudoers file|allowed to run sudo on ))/m;

/** ★ An EACCES outside every prefix is almost always a directory the stack forgot to declare. */
const undeclared =
  (path: string, prefixes: readonly string[]) =>
  (cause: unknown): never => {
    const code = errnoCode(cause);
    if (code !== 'EACCES' && code !== 'EPERM') throw cause;
    throw new Error(
      `sudoRunner ${path}: ${code} as the deploying user, and the path is under no declared prefix ` +
        `(${prefixes.join(', ')}). If root owns its directory, declare that directory as a prefix.`,
      { cause },
    );
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
    if (result.exitCode !== 1) return result;
    if (PASSWORD.test(result.stderr)) {
      throw new SudoRefusedError(
        `sudo -n ${shown}: a password is required, and this runner never prompts. Run \`sudo -v\` ` +
          'in the deploying terminal just before the deploy, or grant exactly these commands ' +
          'NOPASSWD (docs/launchd-sudo.md). The command did not run.',
      );
    }
    if (NOT_ALLOWED.test(result.stderr)) {
      throw new SudoRefusedError(
        `sudo -n ${shown}: sudoers does not let the deploying user run this. The command did not run.`,
      );
    }
    return result;
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
        return base.writeFileAtomic(path, bytes, options).catch(undeclared(path, prefixes));
      }
      const mode = octalMode(options.mode);
      if (mode === undefined)
        throw new SudoRefusedError(`sudoRunner ${path}: mode must be 0–0o7777`);
      await assertPlainPath(base, prefix, path, 'file-or-absent');
      await assertReadableBack(base, path, options, await deps.groups());
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
