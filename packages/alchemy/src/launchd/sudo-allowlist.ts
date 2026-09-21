/**
 * Everything sudo-runner.ts may run as root, as exact argv shapes, plus the rule for which calls
 * need root at all. Pure: no I/O, so every shape is tested without sudo (sudo-allowlist.test.ts).
 *
 * ⛔ AN ALLOWLIST OF SHAPES, NOT OF PROGRAMS. Allowing "launchctl" would allow `bootout system` with
 *   no service, which removes the whole system domain, and `bootstrap system <directory>`, which
 *   loads every plist in that directory (launchctl(1), read on macOS 27.2 on 2026-09-21). Each shape
 *   below fixes the subcommand, the domain, the flags and the number of operands, so neither of
 *   those can be written.
 * ⛔ PATHS ARE CHECKED LEXICALLY HERE: absolute, normalised (the same rule a HostFile path obeys,
 *   host-file-form.ts) and STRICTLY under a prefix the stack declared. sudo-guard.ts then checks
 *   the host with lstat: no symlinks, and only regular files.
 * ⛔ `install` COPIES ONLY THE FILE THIS RUNNER STAGED. Any other source would let the runner copy
 *   a file only root can read (/etc/master.passwd, say) to a path the deploying user can read.
 */
import { pathProblems } from './host-file-form.ts';
import { LABEL, RESERVED_LABEL_PREFIXES } from './job-validate.ts';
import { LAUNCHCTL } from './launchctl.ts';

/** ★ Absolute program paths, so neither sudo nor the command is looked up on the caller's PATH. */
export const SUDO = '/usr/bin/sudo';
export const INSTALL = '/usr/bin/install';
export const RM = '/bin/rm';

/** The launchctl subcommands that change a domain. Everything else launchctl does is a read. */
const WRITES: ReadonlySet<string> = new Set(['bootstrap', 'bootout', 'kickstart']);

/** A mode as `install -m` takes it: four octal digits, so `0644` and `4755` are both exact. */
export const octalMode = (mode: number): string | undefined =>
  Number.isSafeInteger(mode) && mode >= 0 && mode <= 0o7777
    ? mode.toString(8).padStart(4, '0')
    : undefined;

/** Validate the stack's prefixes once, when the runner is built. */
export const checkPrefixes = (prefixes: readonly string[]): readonly string[] => {
  if (prefixes.length === 0) {
    throw new Error(
      'sudoRunner: no prefixes. Name the directories root may write, e.g. /Library/LaunchDaemons.',
    );
  }
  for (const prefix of prefixes) {
    const found = prefix === '/' ? ['"/" would allow every path'] : pathProblems(prefix);
    if (found.length > 0) {
      throw new Error(`sudoRunner: prefix ${JSON.stringify(prefix)}: ${found.join('; ')}`);
    }
  }
  return [...prefixes];
};

/**
 * The declared prefix `path` is strictly under, or `undefined`.
 * ⚠️ `${prefix}/`, never a bare startsWith: `/opt/example` must not admit `/opt/example-other`.
 */
export const prefixOf = (path: string, prefixes: readonly string[]): string | undefined =>
  pathProblems(path).length > 0
    ? undefined
    : prefixes.find((prefix) => path.startsWith(`${prefix}/`));

const labelOk = (label: string): boolean =>
  LABEL.test(label) && !RESERVED_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix));

/** `system/<label>`, with a label LaunchdJob itself would accept. */
const systemService = (target: string | undefined): boolean =>
  target !== undefined && target.startsWith('system/') && labelOk(target.slice('system/'.length));

/** A path under a prefix whose file name is `<label>.plist`. */
const daemonPlist = (path: string | undefined, prefixes: readonly string[]): boolean => {
  if (path === undefined || prefixOf(path, prefixes) === undefined) return false;
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.endsWith('.plist') && labelOk(name.slice(0, -'.plist'.length));
};

const launchctlProblem = (
  args: readonly string[],
  prefixes: readonly string[],
): string | undefined => {
  const [sub, ...rest] = args;
  if (sub === 'bootstrap') {
    return rest.length === 2 && rest[0] === 'system' && daemonPlist(rest[1], prefixes)
      ? undefined
      : 'bootstrap takes exactly `system <prefix>/<label>.plist`';
  }
  if (sub === 'bootout') {
    return rest.length === 1 && systemService(rest[0])
      ? undefined
      : 'bootout takes exactly `system/<label>`, never a bare domain';
  }
  if (sub === 'kickstart') {
    const flags = rest.slice(0, -1);
    const flagsOk =
      flags.every((flag) => flag === '-k' || flag === '-p') && new Set(flags).size === flags.length;
    return flagsOk && systemService(rest[rest.length - 1])
      ? undefined
      : 'kickstart takes only -k / -p, then `system/<label>`';
  }
  return `launchctl ${String(sub)} is never run as root`;
};

const ID = /^\d+$/;

/** `install`'s optional owner flags: none, `-o N`, `-g N`, or `-o N -g N`. Numeric ids only. */
const idsOk = (ids: readonly string[]): boolean => {
  const [flag, id, second, secondId] = ids;
  if (ids.length === 0) return true;
  if (ids.length === 2) return (flag === '-o' || flag === '-g') && ID.test(id ?? '');
  return (
    ids.length === 4 &&
    flag === '-o' &&
    ID.test(id ?? '') &&
    second === '-g' &&
    ID.test(secondId ?? '')
  );
};

/** The one source `install` may copy and the prefixes, for the call being checked. */
export type AllowContext = { readonly prefixes: readonly string[]; readonly staged?: string };

/** `undefined` when `argv` is exactly an allowed privileged shape, else the reason it is not. */
export const privilegedProblem = (
  argv: readonly string[],
  context: AllowContext,
): string | undefined => {
  const [program, ...args] = argv;
  const under = (path: string | undefined) =>
    path !== undefined && prefixOf(path, context.prefixes) !== undefined;
  if (program === LAUNCHCTL) return launchctlProblem(args, context.prefixes);
  if (program === INSTALL) {
    // -S -m MODE [-o UID] [-g GID] STAGED DEST: nothing else, in this order.
    const [safe, m, mode, ...rest] = args;
    if (safe !== '-S' || m !== '-m' || mode === undefined || !/^[0-7]{4}$/.test(mode)) {
      return 'install takes exactly `-S -m <4 octal digits> [-o <uid>] [-g <gid>] <staged> <dest>`';
    }
    if (rest.length < 2 || !idsOk(rest.slice(0, -2))) return 'install takes only -o <uid> -g <gid>';
    const [source, dest] = rest.slice(-2);
    if (source === undefined || source !== context.staged) {
      return 'install copies only the file this runner staged';
    }
    return under(dest) ? undefined : 'install destination is not under a declared prefix';
  }
  if (program === RM) {
    const [force, end, path, ...extra] = args;
    return force === '-f' && end === '--' && extra.length === 0 && under(path)
      ? undefined
      : 'rm takes exactly `-f -- <path under a declared prefix>`';
  }
  return `${String(program)} is not on the sudo allowlist`;
};

/** Where one exec goes: run as the deploying user, run as root through the allowlist, or refused. */
export type Route =
  | { readonly as: 'operator' }
  | { readonly as: 'root' }
  | { readonly refuse: string };

/**
 * ★ WHY THIS REFUSES AS WELL AS ROUTES. sudoRunner reports `privileged: true`, which switches off
 *   the providers' own "another user's gui domain needs root" refusal (job-preflight.ts). This
 *   runner elevates only the system domain, so it gives that refusal back itself. (A write into
 *   another user's LaunchAgents is refused by the writer first: outside every prefix, a foreign
 *   owner needs root. This covers the delete, which reaches launchctl before any file.)
 * ⚠️ Reads (`print`, `print-disabled`) always run as the deploying user: launchctl(1) says anyone
 *   may read or query the system domain, and launchctl.ts measured it on 2026-09-21.
 */
export const routeExec = (argv: readonly string[], operatorUid: number): Route => {
  const [program, sub] = argv;
  if (program === 'sudo' || program?.endsWith('/sudo') === true) {
    return {
      refuse: 'sudoRunner never passes a sudo argv through; it elevates only its allowlist',
    };
  }
  if (program !== LAUNCHCTL || sub === undefined || !WRITES.has(sub)) return { as: 'operator' };
  const target = sub === 'kickstart' ? argv[argv.length - 1] : argv[2];
  if (target === 'system' || target?.startsWith('system/') === true) return { as: 'root' };
  const owner = /^(?:gui|user)\/(\d+)(?:\/|$)/.exec(target ?? '')?.[1];
  if (owner === undefined || Number(owner) === operatorUid) return { as: 'operator' };
  return {
    refuse:
      `launchctl ${sub} ${String(target)}: that domain belongs to uid ${owner}, and sudoRunner ` +
      'elevates only the system domain. Deploy as that user, or as root.',
  };
};
