/**
 * ONE READ OF `ls -ldn --` FOR A WHOLE LIST OF PATHS, parsed into the same FileStat the seam uses
 * plus the one thing `stat` cannot say on Linux: whether the path carries a POSIX ACL.
 *
 * ★ WHY `ls` AND NOT `stat`, AND WHY ONE CALL. The Mac guard lstats every directory from `/` down
 *   with a local syscall each; over ssh each of those is a TCP connection with no multiplexing
 *   (ssh-runner.ts), so a five-deep chain would be five handshakes per check and per plan. `ls -ldn`
 *   takes every path as an operand and answers in one connection, and its mode column carries the
 *   ACL flag the chain check needs anyway.
 * ★ MEASURED 2026-09-22, read-only over ssh, on two host classes — an unprivileged LXC container
 *   and a Proxmox VE node, both Debian 13 / coreutils 9.7, LANG=C, ssh user uid 1001 and 1000:
 *     $ ls -ldn / /etc /etc/systemd /etc/systemd/system /usr /usr/lib /usr/lib/systemd …
 *       drwxr-xr-x 18 0 0 4096 Sep 22 10:12 /etc          (all ten root:root 0755, no flag)
 *     $ ls -ld /var/log/journal
 *       drwxr-sr-x+ 3 root systemd-journal …              (the `+` IS the POSIX ACL flag here)
 *     $ ls -lden …  →  ls: invalid option -- 'e'          (the Mac's spelling does not exist)
 *     $ command -v getfacl  →  absent on both Debian classes (present on the NixOS class)
 *   ⛔ SO THE ACL SIGNAL IS THE `+` FLAG, NOT `getfacl`: the tool that would enumerate the entries
 *     is not installed on the hosts this runner is for, and a guard that shells out to a missing
 *     program and fails closed would refuse every write on them. `ls` is coreutils, always there.
 *   ⚠️ THE PRICE, STATED: we learn THAT a directory has an ACL, never WHAT it grants, so any ACL on
 *     the chain is a refusal — including a read-only one the Mac guard would allow. Fail closed and
 *     say so; the remedy is a prefix without one.
 * ⚠️ `.` in that column is an SELinux context, not an ACL, and is not a grant. `@` is macOS's.
 * ⛔ FAIL CLOSED ON ANYTHING WE DO NOT UNDERSTAND. A line that does not parse, a path that no line
 *   named, two lines for one path, or a non-zero exit is an error — never "nothing is there".
 */
import type { FileStat, HostRunner } from '../launchd/runner.ts';
import { SudoRefusedError } from '../launchd/sudo-allowlist.ts';

/** What one `ls -ldn` line says: the lstat fields, plus whether the path carries an ACL. */
export type Listed = FileStat & { readonly acl: boolean };

const KINDS = new Map<string, FileStat['kind']>([
  ['-', 'file'],
  ['d', 'directory'],
  ['l', 'symlink'],
]);

/**
 * `rwxr-x---` → 0o750, with the three special bits `ls` hides in the execute columns:
 * `s`/`S` = setuid (user) or setgid (group), `t`/`T` = sticky; the capital is the bit without
 * execute. ⚠️ Anything else in a column is a shape we do not know, and returns undefined.
 */
export const permBits = (perms: string): number | undefined => {
  if (perms.length !== 9) return undefined;
  let mode = 0;
  for (const index of [0, 1, 2]) {
    const at = index * 3;
    const shift = 6 - at;
    const [read, write, exec] = [perms[at], perms[at + 1], perms[at + 2]];
    if ((read !== 'r' && read !== '-') || (write !== 'w' && write !== '-')) return undefined;
    if (read === 'r') mode |= 0o4 << shift;
    if (write === 'w') mode |= 0o2 << shift;
    const [set, unset] = index === 2 ? ['t', 'T'] : ['s', 'S'];
    if (exec === 'x' || exec === set) mode |= 0o1 << shift;
    else if (exec !== '-' && exec !== unset) return undefined;
    if (exec === set || exec === unset) mode |= 0o4000 >> index;
  }
  return mode;
};

/** `drwxr-xr-x+ 4 0 0 4096 Sep 22 10:12 /etc/systemd` — the tail holds the date and the name. */
const LINE = /^([-dlbcps])(\S{9})([+.@]?)\s+\d+\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/;

/**
 * Match each line to the path that asked for it, by NAME rather than by position.
 * ⚠️ `ls` SORTS ITS OPERANDS, so the answers do not come back in the order they were asked; and a
 *   symlink's line ends `<path> -> <target>`, so it is not a suffix match either. The longest
 *   candidate wins, so a path that is a tail of another cannot steal its line.
 */
const nameOf = (tail: string, paths: readonly string[]): string | undefined =>
  [...paths]
    .sort((left, right) => right.length - left.length)
    .find((path) => tail.endsWith(` ${path}`) || tail.includes(` ${path} -> `));

/** Every requested path's entry, or `undefined` when the listing is not exactly that. */
export const parseListing = (
  stdout: string,
  paths: readonly string[],
): Map<string, Listed> | undefined => {
  const entries = new Map<string, Listed>();
  for (const line of stdout.split('\n').filter((text) => text.trim() !== '')) {
    const match = LINE.exec(line);
    if (match === null) return undefined;
    const [, type, perms, flag, uid, gid, size, tail] = match;
    const mode = permBits(perms ?? '');
    const path = nameOf(tail ?? '', paths);
    if (mode === undefined || path === undefined || entries.has(path)) return undefined;
    entries.set(path, {
      acl: flag === '+',
      gid: Number(gid),
      kind: KINDS.get(type ?? '') ?? 'other',
      mode,
      size: Number(size),
      uid: Number(uid),
    });
  }
  return entries.size === paths.length ? entries : undefined;
};

/**
 * Read every path in one call, as the deploying user — no sudo, the same read at plan time and
 * before the write. ⛔ Anything but a complete, understood listing is a SudoRefusedError: a chain
 *   we could not read is a chain we cannot say is root's alone.
 */
export const readListing = async (
  base: HostRunner,
  ls: string,
  what: string,
  paths: readonly string[],
): Promise<Map<string, Listed>> => {
  const result = await base.exec([ls, '-ldn', '--', ...paths]);
  const entries = result.exitCode === 0 ? parseListing(result.stdout, paths) : undefined;
  if (entries === undefined) {
    throw new SudoRefusedError(
      `sudoRunner ${what}: could not read ${paths.join(', ')} (${ls} -ldn exit ` +
        `${String(result.exitCode)}: ${result.stderr.trim().slice(0, 200)}). Nothing ran as root.`,
    );
  }
  return entries;
};
