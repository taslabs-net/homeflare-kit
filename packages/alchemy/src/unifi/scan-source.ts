/**
 * Shared comment/string-aware source scanner for `src/unifi`'s static banned-token tests:
 * `write-op-reference.test.ts` (T12 — no SDK write-op reference anywhere in this directory) and
 * `wifi-broadcast-details-call.test.ts` (T23 — no reference to the passphrase-bearing
 * `getWifiBroadcastDetails` GET). Extracted (red team, IMPORTANT-2, 2026-09-26) so both share the
 * ONE left-to-right, single-state comment stripper instead of each maintaining its own — see the
 * history below for why a naive or duplicated implementation is a real trap here, not a
 * hypothetical one.
 *
 * ⚠️ COMMENTS ARE STRIPPED WITH A SINGLE LEFT-TO-RIGHT SCAN, NOT TWO INDEPENDENT REGEXES. An
 *   earlier "mask strings, then regex the comments" attempt had its own bug: an apostrophe in
 *   ordinary prose ("doesn't", "it's") reads as an unterminated string open to any regex that does
 *   not already know it is inside a comment, and can swallow real code up to the next quote
 *   anywhere later in the file. `stripComments` tracks ONE state (code / line comment / block
 *   comment / string) char by char left to right, so a comment can't be misread as a string and a
 *   string's contents (a banned token hidden in one, e.g. `alias['deleteNetwork']`, is still an
 *   offense) are never mistaken for a comment either.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One left-to-right scan tracking a single state (code / `//` / `/* *\/` / string). Comments are
 * blanked to spaces (newlines kept, so a caller's own line-number diagnostics still line up);
 * string and template literal CONTENTS are left untouched, because a banned token hidden inside
 * one is still an offense a caller needs to see.
 */
export const stripComments = (src: string): string => {
  let out = '';
  for (let i = 0; i < src.length;) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
      const quote = src[i];
      let j = i + 1;
      while (j < src.length && src[j] !== quote) j += src[j] === '\\' ? 2 : 1;
      const stop = Math.min(j + 1, src.length);
      out += src.slice(i, stop);
      i = stop;
    } else {
      out += src[i];
      i += 1;
    }
  }
  return out;
};

/** Every `.ts` file under `dir`, recursively — a future `src/unifi/<subdir>/*.ts` is walked too. */
export const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : entry.name.endsWith('.ts') ? [full] : [];
  });

export const readSource = (path: string): string => readFileSync(path, 'utf8');
