/**
 * The vendor checksum file, parsed strictly — the shape every pin in catalog.ts was copied from.
 *
 * ★ WHY PARSE A FILE THE PROVIDER NEVER FETCHES. The pins are the ground truth at apply; this is
 *   the ground truth when a pin is WRITTEN. catalog.test.ts feeds it the exact bytes of all four
 *   recorded files (fixtures/, each matching GitHub's digest of that asset) and requires the catalog
 *   to equal what it reads, so a pin typed by hand, a line missed, or a member added by the vendor
 *   is a failing test rather than a trusted typo.
 * ⛔ STRICT, BECAUSE THE FORMAT IS KNOWN. Measured 2026-09-22 on all four files: `sha256sum` text
 *   mode — `<64 lowercase hex><two spaces><name>` per line, LF endings, a trailing newline, the
 *   archive on line 1 and one `-prod` member per line after it. Anything else (a `*` binary-mode
 *   marker, CRLF, upper-case hex, a blank line, a repeated name) is a refusal: a file that no longer
 *   has this shape is a vendor change to read before any pin moves, not something to guess past.
 */

const LINE = /^([0-9a-f]{64}) {2}([^\s/]+)$/;

/** Name → SHA-256, in file order. Throws, naming the line, on anything but the measured shape. */
export const parseChecksums = (text: string): ReadonlyMap<string, string> => {
  if (!text.endsWith('\n')) throw new Error('checksum file: no trailing newline');
  const lines = text.slice(0, -1).split('\n');
  const digests = new Map<string, string>();
  for (const [index, line] of lines.entries()) {
    const match = LINE.exec(line);
    if (match === null) {
      throw new Error(
        `checksum file line ${String(index + 1)}: not "<sha256>  <name>": ${JSON.stringify(line)}`,
      );
    }
    const [, digest = '', name = ''] = match;
    if (digests.has(name)) {
      throw new Error(`checksum file line ${String(index + 1)}: "${name}" is listed twice`);
    }
    digests.set(name, digest);
  }
  if (digests.size === 0) throw new Error('checksum file: no lines');
  return digests;
};
