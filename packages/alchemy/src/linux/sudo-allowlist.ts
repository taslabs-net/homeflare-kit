/**
 * Everything sshSudoRunner may run as root, as exact argv shapes, plus the rule for which calls
 * need root at all. Pure: no I/O, so every shape is tested without ssh (sudo-allowlist.test.ts).
 * The Linux twin of `../launchd/sudo-allowlist.ts` — reused directly where the rule is generic
 * (prefixes, octal 4-digit modes, `SudoRefusedError`), rewritten where GNU coreutils and systemd
 * need a different shape than macOS's `install -S` and `launchctl`.
 *
 * ⛔ AN ALLOWLIST OF SHAPES, NOT OF PROGRAMS. `chown` unqualified would let a bug hand any file to
 *   any uid; `systemctl` unqualified would let `disable --global` reach every user's units. Each
 *   shape below fixes the flags, the operand count and (for install/mv) which paths may appear.
 * ⛔ `install` COPIES ONLY THE FILE THIS RUNNER STAGED, into ONLY the temp path this runner derived
 *   for the current write — never argv's own idea of either. Binding both stops a bug (or a future
 *   change) from turning this into "install any file the operator can read to any path root can
 *   reach".
 * ⛔ GNU `install` WRITES THROUGH ITS DESTINATION (ssh-scripts.ts's header), unlike macOS's, which
 *   stages and renames on its own. So there is no `-S`: this allowlist's `install` writes a FRESH
 *   temp file (never the live path), and only `mv` — a rename(2), atomic by construction — ever
 *   touches the path a provider declared.
 */
import { NAME as UNIT_NAME } from './unit-form.ts';
import {
  INSTALL,
  SUDO,
  SudoRefusedError,
  checkPrefixes,
  octalMode,
  prefixOf,
} from '../launchd/sudo-allowlist.ts';
import { CHMOD, CHOWN, MKDIR, RMDIR, dirProgramProblem } from './sudo-allowlist-dir.ts';

export { INSTALL, SUDO, SudoRefusedError, checkPrefixes, octalMode, prefixOf };
export { CHMOD, CHOWN, MKDIR, RMDIR } from './sudo-allowlist-dir.ts';

/** ★ Absolute program paths, so neither sudo nor the command is looked up on the operator's PATH. */
export const MV = '/usr/bin/mv';
export const RM = '/usr/bin/rm';
export const SYSTEMCTL_ABS = '/usr/bin/systemctl';

/** The bare names `directory-lifecycle.ts` and `systemctl.ts` already send through `exec()`. */
export const DIRECTORY_PROGRAMS: ReadonlySet<string> = new Set([
  'mkdir',
  'chmod',
  'chown',
  'rmdir',
]);
const DIRECTORY_PROGRAMS_ABS: ReadonlySet<string> = new Set([MKDIR, CHMOD, CHOWN, RMDIR]);
const ABS_OF: Readonly<Record<string, string>> = {
  chmod: CHMOD,
  chown: CHOWN,
  mkdir: MKDIR,
  rmdir: RMDIR,
  systemctl: SYSTEMCTL_ABS,
};
/** The bare argv a provider sends → the absolute argv sudo may run. Unknown programs pass through. */
export const canonicalize = (argv: readonly string[]): readonly string[] => {
  const abs = ABS_OF[argv[0] ?? ''];
  return abs === undefined ? argv : [abs, ...argv.slice(1)];
};

const ID = /^\d+$/;
/** `install`'s optional owner flags: none, `-o N`, `-g N`, or `-o N -g N`. Numeric ids only. */
const idsOk = (ids: readonly string[]): boolean => {
  if (ids.length === 0) return true;
  if (ids.length === 2) return (ids[0] === '-o' || ids[0] === '-g') && ID.test(ids[1] ?? '');
  return (
    ids.length === 4 &&
    ids[0] === '-o' &&
    ID.test(ids[1] ?? '') &&
    ids[2] === '-g' &&
    ID.test(ids[3] ?? '')
  );
};

const dirOf = (path: string): string => path.slice(0, path.lastIndexOf('/')) || '/';

/** The one source `install` may copy, the one temp `install`/`mv` may touch, and the prefixes. */
export type AllowContext = {
  readonly prefixes: readonly string[];
  readonly staged?: string;
  readonly temp?: string;
};

const installProblem = (args: readonly string[], context: AllowContext): string | undefined => {
  const [m, mode, ...rest] = args;
  if (m !== '-m' || mode === undefined || !/^[0-7]{4}$/.test(mode)) {
    return 'install takes exactly `-m <4 octal digits> [-o <uid>] [-g <gid>] -T -- <staged> <temp>`';
  }
  const at = rest.indexOf('-T');
  const tail = at === -1 ? [] : rest.slice(at);
  if (at === -1 || !idsOk(rest.slice(0, at)) || tail.length !== 4 || tail[1] !== '--') {
    return 'install takes exactly `-m <4 octal digits> [-o <uid>] [-g <gid>] -T -- <staged> <temp>`';
  }
  const [, , source, dest] = tail;
  if (source === undefined || source !== context.staged) {
    return 'install copies only the file this runner staged';
  }
  if (dest === undefined || dest !== context.temp) {
    return 'install writes only the derived temp path for this write';
  }
  return prefixOf(dest, context.prefixes) === undefined
    ? 'install destination is not under a declared prefix'
    : undefined;
};

const mvProblem = (args: readonly string[], context: AllowContext): string | undefined => {
  const [f, t, dd, source, dest] = args;
  if (f !== '-f' || t !== '-T' || dd !== '--' || args.length !== 5) {
    return 'mv takes exactly `-f -T -- <temp> <dest>`';
  }
  if (source === undefined || source !== context.temp) {
    return 'mv moves only the temp path this runner just installed to';
  }
  if (dest === undefined || prefixOf(dest, context.prefixes) === undefined) {
    return 'mv destination is not under a declared prefix';
  }
  return dirOf(source) === dirOf(dest)
    ? undefined
    : 'mv must stay inside the destination’s directory';
};

const rmProblem = (args: readonly string[], context: AllowContext): string | undefined => {
  const [force, end, path, ...extra] = args;
  return force === '-f' &&
    end === '--' &&
    extra.length === 0 &&
    path !== undefined &&
    prefixOf(path, context.prefixes) !== undefined
    ? undefined
    : 'rm takes exactly `-f -- <path under a declared prefix>`';
};

const BANNED_SYSTEMCTL_FLAGS: ReadonlySet<string> = new Set([
  '--user',
  '--global',
  '-H',
  '-M',
  '--root',
]);
const UNIT_WRITE_VERBS: ReadonlySet<string> = new Set([
  'enable',
  'disable',
  'start',
  'stop',
  'restart',
]);

const systemctlProblem = (
  args: readonly string[],
  prefixes: readonly string[],
): string | undefined => {
  if (args.some((arg) => BANNED_SYSTEMCTL_FLAGS.has(arg))) {
    return 'systemctl --user/--global/-H/-M/--root is never run as root';
  }
  const [verb, ...rest] = args;
  if (verb === 'daemon-reload')
    return rest.length === 0 ? undefined : 'daemon-reload takes no operands';
  if (verb !== undefined && UNIT_WRITE_VERBS.has(verb)) {
    const [dd, unit, ...extra] = rest;
    return dd === '--' && unit !== undefined && UNIT_NAME.test(unit) && extra.length === 0
      ? undefined
      : `${verb} takes exactly \`-- <unit>\``;
  }
  return `systemctl ${String(verb)} is never run as root`;
};

/** `undefined` when `argv` is exactly an allowed privileged shape, else the reason it is not. */
export const privilegedProblem = (
  argv: readonly string[],
  context: AllowContext,
): string | undefined => {
  const [program, ...args] = argv;
  if (program === INSTALL) return installProblem(args, context);
  if (program === MV) return mvProblem(args, context);
  if (program === RM) return rmProblem(args, context);
  if (program === SYSTEMCTL_ABS) return systemctlProblem(args, context.prefixes);
  if (program === MKDIR || program === CHMOD || program === CHOWN || program === RMDIR) {
    return dirProgramProblem(program, args, context.prefixes);
  }
  return `${String(program)} is not on the sudo allowlist`;
};

/** Where one exec goes: run as the operator, run as root through the allowlist, or refused. */
export type Route =
  | { readonly as: 'operator' }
  | { readonly as: 'root' }
  | { readonly refuse: string };

/**
 * ★ ROUTING NEVER TOUCHES THE HOST. mkdir/chmod/chown/rmdir go to root only under a declared
 *   prefix — outside one they run as the operator, who may well own that path (H3/rule 7).
 *   systemctl's write verbs always ATTEMPT root; the FragmentPath check that can still refuse one
 *   needs a host read, so it runs in the runner's `before` hook, not here.
 */
export const routeExec = (argv: readonly string[], prefixes: readonly string[]): Route => {
  const [program, ...args] = argv;
  if (program === 'sudo' || program?.endsWith('/sudo') === true) {
    return {
      refuse: 'sshSudoRunner never passes a sudo argv through; it elevates only its allowlist',
    };
  }
  if (program === 'systemctl' || program === SYSTEMCTL_ABS) {
    if (args.some((arg) => BANNED_SYSTEMCTL_FLAGS.has(arg))) {
      return { refuse: 'sshSudoRunner refuses systemctl --user/--global/-H/-M/--root' };
    }
    const [verb] = args;
    return verb === 'daemon-reload' || (verb !== undefined && UNIT_WRITE_VERBS.has(verb))
      ? { as: 'root' }
      : { as: 'operator' };
  }
  // ★ Both spellings route the same way — a caller that happened to pass the absolute program
  //   (nothing in this repo does today) must not silently fall through to the operator branch.
  if (DIRECTORY_PROGRAMS.has(program ?? '') || DIRECTORY_PROGRAMS_ABS.has(program ?? '')) {
    const path = args[args.length - 1];
    return path !== undefined && prefixOf(path, prefixes) !== undefined
      ? { as: 'root' }
      : { as: 'operator' };
  }
  return { as: 'operator' };
};
