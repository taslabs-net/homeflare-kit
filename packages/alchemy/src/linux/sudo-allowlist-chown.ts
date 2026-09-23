/**
 * `chown`'s two privileged shapes, split out of sudo-allowlist.ts to keep it under the house's
 * 250-line cap: the ROOT-ONLY directory form (sudo-allowlist-dir.ts owns that check) and the
 * FILE-ownership form used only on the derived temp file `sudo-write.ts` `install`s into, for a
 * `RemoteFile` whose declared owner or group is not root.
 *
 * ⛔ `install`'S OWN `-o`/`-g` ARE NEVER USED, ON EITHER PLATFORM'S ALLOWLIST NOW. 🔴 MEASURED
 *   (adversarial review, round 2, 2026-09-23, against coreutils 9.7 `src/install.c` `get_ids()`):
 *   unlike `chown`, `install` does NOT go through gnulib's `+`-aware `userspec.c` at all — its own
 *   `get_ids()` calls `getpwnam(owner_name)` / `getgrnam(group_name)` FIRST for ANY string,
 *   falling back to `xstrtoumax` only when no such account exists, with no `+`-prefix escape of
 *   any kind. So `install -o 0` on a host with a user or group literally named `"0"` installs
 *   owned by THAT account, not uid 0 — and there is no argv shape that closes this for `install`
 *   itself. The fix is to never let `install` set ownership: it always runs with no `-o`/`-g` (so
 *   the fresh temp file lands owned by whoever `sudo` runs it as — root:root, with no name lookup
 *   at all, since omitting the flags skips `get_ids` entirely), and this file's `chown` shape sets
 *   the FINAL ownership afterward, on the same temp file, before `mv`. `chown` DOES support `+`
 *   (gnulib `userspec.c`: `*u == '+' ? NULL : getpwnam(u)`, "if it starts with '+', skip the
 *   look-up") — repeated on each side of a `user:group` spec independently — so this is where the
 *   fix actually lands: `+<uid>`, `:+<gid>`, or `+<uid>:+<gid>`, never a bare digit string.
 */
import { CHOWN, dirProgramProblem } from './sudo-allowlist-dir.ts';

/** Bare `directory-lifecycle.ts` argv (`0`, `:0`, `0:0`, …) → the `+`-forced form sudo may run. */
export const forceNumericOwner = (spec: string): string => {
  const [uidPart, gidPart] = spec.includes(':') ? spec.split(':') : [spec, undefined];
  const uid = uidPart === undefined || uidPart === '' ? '' : `+${uidPart}`;
  const gid = gidPart === undefined ? '' : `:+${gidPart}`;
  return `${uid}${gid}`;
};

/** `+<uid>`, `:+<gid>`, or `+<uid>:+<gid>` — numeric, `+`-forced, either or both sides. */
const SAFE_OWNER = /^(\+\d+(:\+\d+)?|:\+\d+)$/;

/**
 * `chown <safe spec> -- <temp>`, bound to the exact temp `install` just wrote — the file-ownership
 * half of `writeUnderPrefix`'s sequence. Any owner/group is allowed (a `RemoteFile` may declare
 * one), as long as it is numeric and forced; the temp binding is what stops it reaching anywhere
 * else, the same way `mv`'s own binding does.
 */
const fileChownProblem = (args: readonly string[], temp: string): string | undefined => {
  const [owner, end, path, ...extra] = args;
  if (
    owner !== undefined &&
    SAFE_OWNER.test(owner) &&
    end === '--' &&
    extra.length === 0 &&
    path === temp
  ) {
    return undefined;
  }
  return (
    'chown on the staged temp takes exactly `+<uid>`, `:+<gid>` or `+<uid>:+<gid>` -- ' +
    '<the exact temp install just wrote>, numeric and +-forced'
  );
};

/**
 * `chown`'s dispatch: a call bound to `context.temp` (its last argument equals it) is the
 * file-ownership form above; everything else is the directory form, root-only
 * (`sudo-allowlist-dir.ts`'s own `ROOT_OWNER`, `+`-forced the same way).
 */
export const chownProblem = (
  args: readonly string[],
  context: { readonly prefixes: readonly string[]; readonly temp?: string },
): string | undefined => {
  const path = args[args.length - 1];
  if (context.temp !== undefined && path === context.temp)
    return fileChownProblem(args, context.temp);
  return dirProgramProblem(CHOWN, args, context.prefixes);
};
