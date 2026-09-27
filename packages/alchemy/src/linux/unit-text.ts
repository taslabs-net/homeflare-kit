/**
 * The parts of `unit-form.ts`'s validation that inspect the unit file's TEXT rather than its
 * props struct — split out so unit-form.ts stays under the file cap, and because these are one
 * coherent concern: is this INI shape something systemd would actually load. Takes plain strings,
 * never `SystemdUnitProps`, so it never needs to import back from unit-form.ts.
 *
 * ⛔ `[Install]` KEYS ARE `unit-form.ts`'s OWN LIST, NOT SYSTEMD'S FULL VOCABULARY — WantedBy,
 *   RequiredBy, UpsertedBy, Also, Alias, per `systemd.unit(5)` §[Install]. `container-form.ts`'s
 *   own header notes it deliberately does NOT reuse this set: a `.container` file's `[Install]`
 *   supports only Alias/WantedBy/RequiredBy (`podman-systemd.unit(5)`), narrower than this.
 */

export const INSTALL_KEYS = new Set(['WantedBy', 'RequiredBy', 'UpsertedBy', 'Also', 'Alias']);

/** Whether `text` has an `[Install]` section carrying at least one key systemd actually links on. */
export const hasInstallSection = (text: string): boolean => {
  if (!text.includes('[Install]')) return false;
  const after = text.slice(text.indexOf('[Install]'));
  return [...INSTALL_KEYS].some((key) => new RegExp(`^${key}=`, 'm').test(after));
};

/**
 * The first line that is neither blank nor a comment — the line whose shape actually decides
 * whether the file "begins with a [Section]", per `textProblems` below.
 * ★ systemd.syntax(7): "Empty lines and lines starting with '#' or ';' are ignored", with no
 *   carve-out for the position before the first section — a comment header is ordinary content
 *   there, same as anywhere else in the file.
 */
export const firstSubstantiveLine = (text: string): string | undefined =>
  text
    .split('\n')
    .find((line) => !(line.trim() === '' || line.startsWith('#') || line.startsWith(';')));

/**
 * 🔴 MEASURED FALSE, CT100 deploy 2026-09-26 00:11Z: the openbao-agent.service asset's first eight
 *   lines are `#`-comments recording where the file was recovered from (verbatim from the live
 *   host — homeflare-ct100's `src/openbao-agent/files/openbao-agent.service`), and the file is
 *   byte-identical to what systemd already loads there. The old check tested the WHOLE text
 *   against `/^\s*\[[A-Za-z]+]/` — `\s*` skips blank lines and indentation, never a `#`/`;`
 *   comment — so a leading comment line failed it outright. This checks only the first
 *   SUBSTANTIVE line, so any number of leading blank lines and comments are fine and a genuine
 *   `key=value` before any section — the one real error this exists to catch — still fails, since
 *   that line is neither blank nor a comment either.
 */
export const textProblems = (text: string): string[] => {
  const found: string[] = [];
  if (text.trim() === '') found.push('the unit file is empty');
  if (text.includes('\u0000')) found.push('the unit file contains NUL');
  const first = firstSubstantiveLine(text);
  // ★ `\s*` kept from the original regex — leading indentation on the SECTION line itself was
  //   already tolerated before this fix and stays that way; only the leading-comment shape changes.
  if (first === undefined || !/^\s*\[[A-Za-z]+]/.test(first)) {
    found.push(
      'a unit file must begin with a [Section] (blank lines and #/; comments before it are fine)',
    );
  }
  return found;
};
