/**
 * A tar reader with one job: hand back the NAMED regular files of a vendor archive, and refuse the
 * whole archive if any entry could make a name mean something other than what it says.
 *
 * ★ IN PROCESS, NOT `tar` ON THE HOST. An exec'd tar writes through its own path — past the
 *   HostRunner seam, past sudoRunner's allowlist, and past the member digest check, which has to
 *   see the bytes BEFORE they exist on any disk. Nothing this file reads is ever written by it.
 * ★ STREAMING. It is fed the gunzip output chunk by chunk; an entry nobody asked for is counted
 *   past, never held. vmutils unpacks to 264 MB across seven binaries (measured 2026-09-22) and a
 *   stack wants two, so the unpacked archive never exists whole in memory.
 * ⛔ REFUSED, WHOLE ARCHIVE, whichever entry it is and whether or not it was asked for:
 *   an absolute name; a `..` segment; a hard link, symlink, directory, device, FIFO or contiguous
 *   file (only a regular file is accepted); a name given twice; a header whose checksum fails; a
 *   size in GNU base-256; a header that is neither ustar nor GNU; a lone zero block between entries;
 *   non-zero bytes after the end marker; an archive that stops before it.
 * ★ GNU LONG NAMES ('L', 'K') AND PAX HEADERS ('x', 'g') ARE REFUSED, NOT INTERPRETED. Each renames
 *   the entry after it: a reader that honours them must get them exactly right to match exactly,
 *   and one that skips them matches under the wrong name. Refusing costs nothing for an archive
 *   that carries neither, and a vendor format change becomes a refusal that says what changed
 *   instead of a silent mis-read.
 * ★ AN OPTIONAL `root`: ONE DECLARED LEADING DIRECTORY, STRIPPED, NEVER GUESSED. Measured
 *   2026-09-23: `gh api repos/<o>/<r>/releases/tags/<tag>` for each asset URL and digest, the
 *   archive downloaded into a scratch directory (never executed), re-hashed against GitHub's
 *   `digest`, then read by THIS reader (a driver script importing `tarReader`) both before and
 *   after this change — refused whole either way without `root`, and, with it, parsed to
 *   completion: `alertmanager-0.33.1.darwin-arm64.tar.gz` (37,247,168 B),
 *   `blackbox_exporter-0.28.0.darwin-arm64.tar.gz` (15,705,022 B),
 *   `node_exporter-1.12.1.darwin-arm64.tar.gz` (5,368,643 B) and
 *   `postgres_exporter-0.20.1.darwin-arm64.tar.gz` (10,072,235 B) each recompute to GitHub's own
 *   `digest`, and each wraps every entry in exactly one directory (typeflag '5', size 0, first)
 *   named `<binary>-<version>.darwin-arm64/`, holding only root-level regular files (the binary,
 *   `LICENSE`, `NOTICE`, and for alertmanager also `amtool` and `alertmanager.yml`) — no PAX or
 *   GNU long-name entries, so this reader's refusal of both stays exactly as costly as before.
 *   Without `root`, EVERY refusal above still holds byte-for-byte: a directory entry — the wrapper
 *   included — is refused the same way it always was (docs/release-binary-catalogs.md,
 *   docs/release-binary-upstream.md gap 11).
 */
import { ArchiveRefused } from './refused.ts';

const BLOCK = 512;

const KINDS: Readonly<Record<string, string>> = {
  '1': 'a hard link',
  '2': 'a symlink',
  '3': 'a character device',
  '4': 'a block device',
  '5': 'a directory',
  '6': 'a FIFO',
  '7': 'a contiguous file',
  K: 'a GNU long-link header',
  L: 'a GNU long-name header',
  g: 'a PAX global header',
  x: 'a PAX extended header',
};

const refuse = (message: string): ArchiveRefused => new ArchiveRefused({ message });
const strict = new TextDecoder('utf-8', { fatal: true });
const ascii = new TextDecoder('latin1');

/** One NUL-terminated header field. */
const field = (block: Uint8Array, start: number, length: number): Uint8Array => {
  const slice = block.subarray(start, start + length);
  const end = slice.indexOf(0);
  return end === -1 ? slice : slice.subarray(0, end);
};

const text = (block: Uint8Array, start: number, length: number): string => {
  try {
    return strict.decode(field(block, start, length));
  } catch {
    throw refuse('an entry name is not UTF-8');
  }
};

const octal = (block: Uint8Array, start: number, length: number, what: string): number => {
  const raw = block.subarray(start, start + length);
  if (((raw[0] ?? 0) & 0x80) !== 0) throw refuse(`${what} is base-256 encoded`);
  const digits = ascii
    .decode(raw)
    .replace(/[\0 ]+$/, '')
    .replace(/^ +/, '');
  if (!/^[0-7]+$/.test(digits)) throw refuse(`${what} is not octal: ${JSON.stringify(digits)}`);
  return Number.parseInt(digits, 8);
};

const checksumHolds = (block: Uint8Array): boolean => {
  let sum = 0;
  // The checksum field itself counts as eight spaces (POSIX ustar).
  for (let at = 0; at < BLOCK; at += 1) sum += at >= 148 && at < 156 ? 0x20 : (block[at] ?? 0);
  return sum === octal(block, 148, 8, 'a header checksum');
};

/** Why an entry name is unsafe to trust, or undefined. */
const nameProblem = (name: string): string | undefined => {
  if (name === '') return 'has an empty name';
  if (name.startsWith('/')) return 'is absolute';
  if (name.split('/').includes('..')) return 'climbs out of the archive with ".."';
  return undefined;
};

/** Concatenate chunks into one buffer. */
export const concatBytes = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

export type TarContents = {
  /** The asked-for regular files, by exact name. An asked-for name that is absent is absent here. */
  readonly members: ReadonlyMap<string, Uint8Array>;
  /** Every entry name, in archive order — so a refusal can say what the archive did hold. */
  readonly names: readonly string[];
};

/**
 * A push parser: `push` each chunk of the unzipped stream, then `finish`. Either may throw.
 *
 * @param root When given, exactly one typeflag-'5' entry named `<root>/`, size 0, is accepted and
 *   dropped rather than refused as a directory; every OTHER entry name must begin with the SEGMENT
 *   `<root>/` (a `<root>-evil/x` sibling does not) and is reported, matched and kept under that
 *   prefix stripped off. Omitted, behaviour is byte-identical to a reader with no root at all.
 */
export const tarReader = (wanted: ReadonlySet<string>, root?: string) => {
  const header = new Uint8Array(BLOCK);
  const members = new Map<string, Uint8Array>();
  const names: string[] = [];
  const seen = new Set<string>();
  let phase: 'header' | 'data' | 'pad' | 'end' = 'header';
  let filled = 0;
  let remaining = 0;
  let padding = 0;
  let zeros = 0;
  let name = '';
  let parts: Uint8Array[] | undefined;
  let rootSeen = false;
  const rootPrefix = root === undefined ? undefined : `${root}/`;

  const endEntry = () => {
    if (parts !== undefined) members.set(name, concatBytes(parts));
    parts = undefined;
    phase = padding > 0 ? 'pad' : 'header';
  };

  const startEntry = () => {
    if (header.every((byte) => byte === 0)) {
      zeros += 1;
      if (zeros === 2) phase = 'end';
      return;
    }
    if (zeros > 0) throw refuse('a zero block sits between entries (truncated or spliced)');
    if (!checksumHolds(header)) throw refuse('an entry header fails its checksum');
    const magic = ascii.decode(header.subarray(257, 265));
    const posix = magic === 'ustar\u000000';
    if (!posix && magic !== 'ustar  \u0000')
      throw refuse('an entry header is neither ustar nor GNU');
    const prefix = posix ? text(header, 345, 155) : '';
    const rawName = prefix === '' ? text(header, 0, 100) : `${prefix}/${text(header, 0, 100)}`;
    const problem = nameProblem(rawName);
    if (problem !== undefined) throw refuse(`entry ${JSON.stringify(rawName)} ${problem}`);
    // ★ THE DECLARED ROOT IS RECOGNISED BEFORE THE GENERAL TYPE CHECK, and only by exact name: a
    //   directory entry under any other name — nested, or a second copy of the root itself — still
    //   falls through to that check below and is refused as a directory, same as with no root.
    if (rootPrefix !== undefined && rawName === rootPrefix) {
      if (rootSeen) {
        throw refuse(
          `entry "${rawName}" is a second directory entry; only the declared root is accepted`,
        );
      }
      const type = String.fromCharCode(header[156] ?? 0);
      const size = octal(header, 124, 12, `entry "${rawName}"'s size`);
      if (type !== '5' || size !== 0) {
        throw refuse(`entry "${rawName}" is the declared root but is not an empty directory`);
      }
      rootSeen = true;
      phase = 'header';
      return;
    }
    let stripped = rawName;
    if (rootPrefix !== undefined) {
      if (!rawName.startsWith(rootPrefix)) {
        throw refuse(`entry "${rawName}" is outside the declared root "${rootPrefix}"`);
      }
      stripped = rawName.slice(rootPrefix.length);
      if (stripped === '') throw refuse(`entry "${rawName}" has an empty name under the root`);
    }
    name = stripped;
    const type = String.fromCharCode(header[156] ?? 0);
    if (type !== '0' && type !== '\0') {
      const kind = KINDS[type] ?? `of unknown type ${JSON.stringify(type)}`;
      throw refuse(`entry "${rawName}" is ${kind}; only regular files are accepted`);
    }
    if (seen.has(name)) throw refuse(`entry "${rawName}" appears twice`);
    seen.add(name);
    names.push(name);
    remaining = octal(header, 124, 12, `entry "${rawName}"'s size`);
    padding = (BLOCK - (remaining % BLOCK)) % BLOCK;
    parts = wanted.has(name) ? [] : undefined;
    phase = 'data';
    if (remaining === 0) endEntry();
  };

  const push = (chunk: Uint8Array): void => {
    let at = 0;
    while (at < chunk.length) {
      if (phase === 'end') {
        if (chunk.subarray(at).some((byte) => byte !== 0)) {
          throw refuse('data follows the end-of-archive marker');
        }
        return;
      }
      if (phase === 'header') {
        const take = Math.min(BLOCK - filled, chunk.length - at);
        header.set(chunk.subarray(at, at + take), filled);
        filled += take;
        at += take;
        if (filled === BLOCK) {
          filled = 0;
          startEntry();
        }
      } else if (phase === 'data') {
        const take = Math.min(remaining, chunk.length - at);
        // ⚠️ slice, not subarray: a chunk's buffer may be reused by the stream after this returns.
        parts?.push(chunk.slice(at, at + take));
        remaining -= take;
        at += take;
        if (remaining === 0) endEntry();
      } else {
        const take = Math.min(padding, chunk.length - at);
        padding -= take;
        at += take;
        if (padding === 0) phase = 'header';
      }
    }
  };

  const finish = (): TarContents => {
    if (phase !== 'end') throw refuse('the archive stops before its end-of-archive marker');
    if (rootPrefix !== undefined && !rootSeen) {
      throw refuse(`the declared root "${rootPrefix}" never appears in the archive`);
    }
    return { members, names };
  };

  return { finish, push };
};
