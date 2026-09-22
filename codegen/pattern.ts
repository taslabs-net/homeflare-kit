/**
 * Vendor `pattern` -> JavaScript RegExp, or nothing at all.
 *
 * 🔴 NEITHER PRODUCT SHIPS A JAVASCRIPT REGEX, AND COPYING ONE VERBATIM IS WORSE THAN DROPPING IT.
 *   Measured 2026-09-22 over both whole schemas — 84 distinct patterns, 18 of them not JavaScript:
 *
 *   - PBS prints its Rust `Regex` through `Display`, SO EVERY PBS PATTERN ARRIVES WRAPPED IN
 *     SLASHES: `/^[[:^cntrl:]]*$/`. `new RegExp` accepts that string happily and it then means
 *     "a literal slash, then ...", which matches NOTHING a PBS field ever holds. A generator that
 *     trusted it would refuse every legal comment at plan time — the exact opposite of the bug
 *     this table exists to catch, and far more damaging.
 *   - PBS uses POSIX classes. `[[:^cntrl:]]` is ALSO accepted by `new RegExp` and ALSO means
 *     something else: JavaScript reads it as the class `[[:^cntrl:]` followed by a literal `]`,
 *     so it matches `:` and `l` and rejects `a`. ⛔ Two silent mis-parses, no exception, no hint.
 *   - PVE prints Perl's inline-modifier reset: `(?^:…)`, `(?^i:…)`, `(?^u:…)`. Those DO throw, so
 *     they are the safe half of the problem.
 *   - PBS also uses `(?P<name>…)` (Rust) for JavaScript's `(?<name>…)`, and a leading `(?m)`.
 *
 * ★ SO THE RULE IS A WHITELIST, NOT A BEST EFFORT. Only the rewrites below are applied; anything
 *   left carrying regex syntax this file does not recognise is DROPPED and recorded verbatim as
 *   `patternSource`, unenforced. A dropped rule costs a server-side rejection we already live
 *   with. A wrongly translated one blocks a deploy that was always legal, and the operator has no
 *   way to tell the difference from a genuine violation.
 */

/** `[:cntrl:]` inside a class, and the whole-class `[[:^cntrl:]]`. Only the classes PBS uses. */
const POSIX: Readonly<Record<string, string>> = {
  alnum: 'A-Za-z0-9',
  alpha: 'A-Za-z',
  cntrl: '\\x00-\\x1f\\x7f',
  digit: '0-9',
  space: '\\s',
  xdigit: '0-9A-Fa-f',
};

/** Anything still exotic after the rewrites. A hit means "drop it", never "try harder". */
const UNTRANSLATED = /\(\?\^|\[:|\(\?P<|\(\?[a-zA-Z]+\)|\\p\{|\\h|\\R|\(\?#/;

export interface TranslatedPattern {
  /** The JavaScript source, without delimiters, or undefined when it could not be translated. */
  readonly js?: string;
  /** `m` when the vendor asked for multi-line. Never `i`: see the ⛔ below. */
  readonly flags: string;
}

/**
 * ⛔ `(?^i:…)` IS DROPPED RATHER THAN LIFTED TO THE `i` FLAG. The flag is whole-pattern and the
 *   group is not, so lifting it widens every other branch — `Proxmox.SdnVnet`'s `alias` is the one
 *   that does this, and a widened alias check would accept names PVE rejects while claiming it
 *   had checked them. Unenforced and honest beats enforced and wrong.
 */
export const translatePattern = (source: string): TranslatedPattern => {
  let body = source;
  let flags = '';
  // PBS: Rust `Display` wraps in slashes. ⚠️ Only a matched pair, and only when nothing follows.
  const wrapped = /^\/(.*)\/$/s.exec(body);
  if (wrapped?.[1] !== undefined) body = wrapped[1];
  // PBS: a leading `(?m)` is a flag in JavaScript, not a group.
  if (body.startsWith('(?m)')) {
    body = body.slice(4);
    flags = 'm';
  }
  body = body.replaceAll('(?P<', '(?<');
  // `[[:^cntrl:]]` -> `[^\x00-\x1f\x7f]`: a whole class that is one negated POSIX class.
  body = body.replace(/\[\[:\^(\w+):\]\]/g, (all, name: string) =>
    POSIX[name] === undefined ? all : `[^${POSIX[name]}]`,
  );
  // `[^\s:/[:cntrl:]]` -> the class's ranges spliced in where the POSIX class stood.
  body = body.replace(/\[:(\w+):\]/g, (all, name: string) => POSIX[name] ?? all);
  return UNTRANSLATED.test(body) || !compiles(body, flags) ? { flags } : { flags, js: body };
};

const compiles = (body: string, flags: string): boolean => {
  try {
    new RegExp(body, flags);
    return true;
  } catch {
    return false;
  }
};
