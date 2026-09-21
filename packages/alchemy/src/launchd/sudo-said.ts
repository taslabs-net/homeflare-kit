/**
 * What sudo's own failure means, for sudo-runner.ts: which exit-1 answers are sudo refusing to run
 * the command (so NOTHING ran as root), and what an EACCES outside every prefix most likely means.
 * Split out of sudo-runner.ts, which keeps only the runner.
 *
 * ⚠️ REASONED, NOT MEASURED: sudo's failure text. The kit never runs sudo. The strings below follow
 *   sudoers(5) for sudo 1.9.17p2 on macOS 27.2 ("a password is required": -n was given but a
 *   password was needed) and sudo(8) (sudo exits 1 when it fails itself).
 */
import { errnoCode } from './local-runner.ts';
import type { ExecResult } from './runner.ts';
import { SudoRefusedError } from './sudo-allowlist.ts';

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
export const undeclared =
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

/**
 * The refusal sudo itself answered for `shown` (the argv as JSON), or `undefined` when the command
 * ran — whatever its own exit code. ★ `SudoRefusedError` always means nothing ran as root.
 */
export const sudoRefusal = (shown: string, result: ExecResult): SudoRefusedError | undefined => {
  if (result.exitCode !== 1) return undefined;
  if (PASSWORD.test(result.stderr)) {
    return new SudoRefusedError(
      `sudo -n ${shown}: a password is required, and this runner never prompts. Run \`sudo -v\` ` +
        'in the deploying terminal just before the deploy, or grant exactly these commands ' +
        'NOPASSWD (docs/launchd-sudo.md). The command did not run.',
    );
  }
  if (NOT_ALLOWED.test(result.stderr)) {
    return new SudoRefusedError(
      `sudo -n ${shown}: sudoers does not let the deploying user run this. The command did not run.`,
    );
  }
  return undefined;
};
