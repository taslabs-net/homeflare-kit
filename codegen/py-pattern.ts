/**
 * Django/DRF `pattern` -> JavaScript RegExp, or nothing at all.
 *
 * 🔴 THE DANGEROUS HALF OF THIS DIALECT COMPILES CLEANLY AND MEANS SOMETHING NARROWER. Measured
 *   2026-09-22 over the whole NetBox 4.7.0 document — 7 distinct patterns, and 2 of them are not
 *   JavaScript in meaning even though `new RegExp` accepts both without complaint:
 *
 *   | pattern            | fields     | Python `re` on a `str`          | JavaScript             |
 *   | ------------------ | ---------- | ------------------------------- | ---------------------- |
 *   | `^[-\w]+$`         | `slug`     | `\w` is UNICODE: `ü`, `é`, `中` | `\w` is `[A-Za-z0-9_]` |
 *   | `^[\w.@+-]+$`      | `username` | same                            | same                   |
 *
 *   Python's `re` is Unicode-aware by default on `str`, so Django ACCEPTS a slug containing an
 *   accented letter. The JavaScript copy REFUSES it. ⛔ That is the one failure mode worse than
 *   the server-side 400 this table exists to replace: a plan that refuses a declaration the
 *   vendor would have taken, with a message blaming the operator for a legal value.
 *
 * ⛔ AND THE `u` FLAG DOES NOT FIX IT. `\w` stays ASCII under `u` in JavaScript; only an explicit
 *   `\p{L}`-class rewrite would widen it, and rewriting a vendor's character class by hand is
 *   exactly the guessing this pipeline exists to forbid. So these are DROPPED and recorded
 *   verbatim as `patternSource`, unenforced — the same posture `pattern.ts` takes for PVE's
 *   `(?^i:…)`. Unenforced and honest beats enforced and wrong.
 *
 * ★ THE OTHER FIVE ARE PLAIN ASCII AND CARRY OVER EXACTLY: `^[-a-zA-Z0-9_]+$` (slug),
 *   `^[0-9a-f]{6}$` (color), `^[a-z0-9_]+$` (name), `^[^/]+$`, and the DNS-name alternation.
 *   Nothing is rewritten; they either survive untouched or they are dropped.
 */
import type { TranslatedPattern } from './pattern.ts';

/**
 * Shorthand classes Python widens over Unicode, plus syntax JavaScript does not share.
 *
 * ⚠️ `\d` AND `\s` ARE IN HERE FOR THE SAME REASON AS `\w`, not out of caution. On a `str`,
 *   Python's `\d` matches Devanagari digits and `\s` matches U+00A0 — both wider than JavaScript.
 *   None appears in NetBox 4.7.0 today; listing them keeps a future schema bump from silently
 *   enforcing a narrowed rule the day the vendor adds one.
 * ⚠️ `\A` / `\Z` are Python's string anchors and `(?P<` its named group; `(?i)` and friends are
 *   inline flags Python allows mid-pattern and JavaScript rejects outright.
 */
const NOT_JAVASCRIPT = /\\[wWdDsSbBAZz]|\(\?P[<=]|\(\?[aiLmsux]+\)|\\p\{|\(\?#/;

/**
 * ⛔ A WHITELIST, NOT A BEST EFFORT — and here the whitelist is "changed nothing". Django emits
 *   the pattern its `RegexValidator` was constructed with, so there is no wrapper to strip and no
 *   dialect marker to lift. Either the source is already valid, ASCII-only JavaScript, or it is
 *   not carried over at all.
 */
export const translateDjangoPattern = (source: string): TranslatedPattern => {
  if (NOT_JAVASCRIPT.test(source)) return { flags: '' };
  try {
    new RegExp(source);
  } catch {
    return { flags: '' };
  }
  return { flags: '', js: source };
};
