/**
 * The `mkdir` / `chmod` / `chown` / `rmdir` half of sudo-allowlist.ts, split out to keep that file
 * under the house's 250-line cap. These four are `Host.Directory`'s whole write surface
 * (directory-lifecycle.ts): this file fixes their argv to the EXACT shapes that file emits.
 *
 * ⛔ `chown` TAKES ONLY NUMERIC IDS, NEVER A NAME. `directory-lifecycle.ts`'s `ownerArg()` already
 *   resolves a name to a uid/gid before building argv, so a name here would mean some other code
 *   path built this argv — refused rather than trusted.
 */
import { prefixOf } from '../launchd/sudo-allowlist.ts';

export const MKDIR = '/usr/bin/mkdir';
export const CHMOD = '/usr/bin/chmod';
export const CHOWN = '/usr/bin/chown';
export const RMDIR = '/usr/bin/rmdir';

/**
 * `mkdir -m` / `chmod`'s mode, exactly as `directory-lifecycle.ts`'s own `octal()` formats it:
 * `mode.toString(8).padStart(3, '0')` — 3 digits, or 4 when a special bit makes it longer.
 */
const DIR_MODE = /^([0-7]{3}|[1-7][0-7]{3})$/;

/** `chown`'s owner argument, exactly as `directory-lifecycle.ts`'s `ownerArg()` builds it. */
const OWNER = /^(\d+(:\d+)?|:\d+)$/;

export const dirProgramProblem = (
  program: string,
  args: readonly string[],
  prefixes: readonly string[],
): string | undefined => {
  const under = (path: string | undefined) =>
    path !== undefined && prefixOf(path, prefixes) !== undefined;
  if (program === MKDIR) {
    const [m, mode, end, path, ...extra] = args;
    return m === '-m' &&
      mode !== undefined &&
      DIR_MODE.test(mode) &&
      end === '--' &&
      extra.length === 0 &&
      under(path)
      ? undefined
      : 'mkdir takes exactly `-m <octal> -- <path under a declared prefix>`';
  }
  if (program === CHMOD) {
    const [mode, end, path, ...extra] = args;
    return mode !== undefined &&
      DIR_MODE.test(mode) &&
      end === '--' &&
      extra.length === 0 &&
      under(path)
      ? undefined
      : 'chmod takes exactly `<octal> -- <path under a declared prefix>`';
  }
  if (program === CHOWN) {
    const [owner, end, path, ...extra] = args;
    return owner !== undefined &&
      OWNER.test(owner) &&
      end === '--' &&
      extra.length === 0 &&
      under(path)
      ? undefined
      : 'chown takes exactly `<numeric owner> -- <path under a declared prefix>`, never a name';
  }
  const [end, path, ...extra] = args;
  return end === '--' && extra.length === 0 && under(path)
    ? undefined
    : 'rmdir takes exactly `-- <path under a declared prefix>`';
};
