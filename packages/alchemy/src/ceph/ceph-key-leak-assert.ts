/**
 * Shared by the two test files that prove `Ceph.AuthEntity` never leaks a minted key through a
 * parse-error message: ceph-auth-parse.test.ts (direct parser calls) and
 * ceph-auth-reconcile-secrecy.test.ts (through the full reconcile loop). Split out so the leak
 * check and the malformed-stdout fixtures are identical in both places — the property being
 * proved (decision 65) is the same one, and two hand-copied versions are exactly the kind of thing
 * that quietly drifts apart.
 *
 * ⛔ TEST-ONLY. Nothing in `src/` imports this outside a `.test.ts` file.
 * ★ NO HYPHEN IN THE SENTINEL. LAND red team (2026-09-26), CONFIRMED: a JSON lexer's "unexpected
 *   identifier" error for a bare (unquoted) token stops at the first character outside
 *   `[A-Za-z0-9_$]`, so a hyphenated sentinel (`sentinel-ceph-key-...`) truncates to its first
 *   word — `.not.toContain(SENTINEL)` on the FULL string then never fires even when that first
 *   word leaked. Cephx keys are base64 (`[A-Za-z0-9+/=]`, no hyphen), so this sentinel is shaped
 *   the same way, and every check here compares 8-character slices, not full-string containment.
 */

/** A cephx-shaped sentinel: looks like a real minted key, no hyphen anywhere to truncate on. */
export const KEY_SHAPED_SENTINEL = 'AQDsentinelKEYsentinelKEY0123456789abcd==';

/** True if any 8-character window of `key` shows up anywhere in `message`. */
export const leaksSliceOf = (message: string, key: string = KEY_SHAPED_SENTINEL): boolean => {
  for (let start = 0; start + 8 <= key.length; start += 1) {
    if (message.includes(key.slice(start, start + 8))) return true;
  }
  return false;
};

/** `auth get`/`auth get-or-create` stdout with the key left as a bare (unquoted) JSON token. */
export const unquotedKeyStdout = (entity: string, key: string = KEY_SHAPED_SENTINEL): string =>
  `[{"entity":"${entity}","key":${key}}]`;

/** The same shape with a trailing comma after the entry — a different malformed-JSON path. */
export const trailingCommaKeyStdout = (entity: string, key: string = KEY_SHAPED_SENTINEL): string =>
  `[{"entity":"${entity}","key":"${key}"},]`;
