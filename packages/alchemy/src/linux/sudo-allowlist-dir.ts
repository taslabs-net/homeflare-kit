/**
 * The `mkdir` / `chmod` / `chown` / `rmdir` half of sudo-allowlist.ts, split out to keep that file
 * under the house's 250-line cap. These four are `Host.Directory`'s whole write surface
 * (directory-lifecycle.ts): this file fixes their argv to the EXACT shapes that file emits.
 *
 * ⛔ `chown` TAKES ONLY NUMERIC IDS, NEVER A NAME. `directory-lifecycle.ts`'s `ownerArg()` already
 *   resolves a name to a uid/gid before building argv, so a name here would mean some other code
 *   path built this argv — refused rather than trusted.
 * 🔴 MEASURED (adversarial review, 2026-09-23, against this file's first shipped version): NEITHER
 *   the mode nor the owner was checked for anything but shape. `mkdir -m 0777 -- <path>` and
 *   `chown 1001:1001 -- <path>` both passed the allowlist untouched. A stack could declare
 *   `HostDirectory({ path: '/etc/systemd/system/x.service.d', mode: 0o777 })`, drop a
 *   `ExecStart=` override into it, and the runner's own next `daemon-reload` + `restart` would run
 *   it as root — a local privilege escalation reachable through this runner's own allowlist, not a
 *   bug in the guard (which never runs against a path this permissive by design).
 * ⛔ SO: NO SPECIAL BITS, NO GROUP/OTHER WRITE, EVER — mirroring the file half's `modeProblem`
 *   (`../launchd/sudo-guard.ts`) but WITHOUT its "handed to another owner" exemption. A directory's
 *   OWNER always has write access through the owner bits alone, so no mode restriction can make a
 *   non-root-owned directory here safe — which is why `chown` below is refused to anything but
 *   root outright, not merely mode-restricted.
 */
import { prefixOf } from '../launchd/sudo-allowlist.ts';

export const MKDIR = '/usr/bin/mkdir';
export const CHMOD = '/usr/bin/chmod';
export const CHOWN = '/usr/bin/chown';
export const RMDIR = '/usr/bin/rmdir';

/**
 * `mkdir -m` / `chmod`'s mode, exactly as `directory-lifecycle.ts`'s own `octal()` formats it:
 * `mode.toString(8).padStart(3, '0')` — 3 digits, or 4 when a special bit makes it longer.
 * Parsed to a number so the setuid/setgid/group/other-write bits can be checked directly, the same
 * mask `modeProblem` uses (`0o6000 | 0o022`).
 */
const parseDirMode = (text: string): number | undefined =>
  /^([0-7]{3}|[1-7][0-7]{3})$/.test(text) ? Number.parseInt(text, 8) : undefined;

const DANGEROUS_MODE_BITS = 0o6022;

/** `undefined` when `mode` is a safe directory mode: no setuid/setgid, no group/other write. */
const dirModeProblem = (mode: number | undefined): string | undefined => {
  if (mode === undefined) return 'mode';
  return (mode & DANGEROUS_MODE_BITS) !== 0
    ? 'a mode with setuid/setgid or group/other write (this runner installs only 0–0o777 minus 0o022, no special bits)'
    : undefined;
};

/** `chown`'s owner argument — root only, in every shape `directory-lifecycle.ts`'s `ownerArg()` builds. */
const ROOT_OWNER = /^(0|:0|0:0)$/;

export const dirProgramProblem = (
  program: string,
  args: readonly string[],
  prefixes: readonly string[],
): string | undefined => {
  const under = (path: string | undefined) =>
    path !== undefined && prefixOf(path, prefixes) !== undefined;
  if (program === MKDIR) {
    const [m, modeText, end, path, ...extra] = args;
    const mode = modeText === undefined ? undefined : parseDirMode(modeText);
    if (m !== '-m' || mode === undefined || end !== '--' || extra.length !== 0 || !under(path)) {
      return 'mkdir takes exactly `-m <octal> -- <path under a declared prefix>`';
    }
    return dirModeProblem(mode);
  }
  if (program === CHMOD) {
    const [modeText, end, path, ...extra] = args;
    const mode = modeText === undefined ? undefined : parseDirMode(modeText);
    if (mode === undefined || end !== '--' || extra.length !== 0 || !under(path)) {
      return 'chmod takes exactly `<octal> -- <path under a declared prefix>`';
    }
    return dirModeProblem(mode);
  }
  if (program === CHOWN) {
    const [owner, end, path, ...extra] = args;
    return owner !== undefined &&
      ROOT_OWNER.test(owner) &&
      end === '--' &&
      extra.length === 0 &&
      under(path)
      ? undefined
      : 'chown takes exactly `0`, `:0` or `0:0` -- <path under a declared prefix>` — root only; ' +
          'a directory this runner elevates never hands ownership to anyone else';
  }
  const [end, path, ...extra] = args;
  return end === '--' && extra.length === 0 && under(path)
    ? undefined
    : 'rmdir takes exactly `-- <path under a declared prefix>`';
};
