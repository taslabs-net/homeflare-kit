/**
 * Trimming runs of one character from caller-supplied paths and names.
 *
 * ★ LOOPS, NOT `/^\/+|\/+$/g`, `/\/+$/` OR `/^-+|-+$/g`. A trailing `x+$` backtracks polynomially
 *   on a long run of `x` followed by anything else (CodeQL js/polynomial-redos), and mount paths,
 *   namespaces and slugs are caller input. Every loop here is linear in the input length.
 */

/** `text` without a trailing run of `char` (one UTF-16 unit). */
export const trimTrailing = (text: string, char: string): string => {
  let end = text.length;
  while (end > 0 && text[end - 1] === char) end -= 1;
  return text.slice(0, end);
};

/** `text` without a leading or trailing run of `char` (one UTF-16 unit). */
export const trimRuns = (text: string, char: string): string => {
  let start = 0;
  while (start < text.length && text[start] === char) start += 1;
  return trimTrailing(text.slice(start), char);
};

/** `text` without trailing `/`. */
export const trimTrailingSlashes = (text: string): string => trimTrailing(text, '/');

/** `text` without leading or trailing `/`. */
export const trimSlashes = (text: string): string => trimRuns(text, '/');

/** SSH mount path without a trailing slash; `ssh` when the caller did not say. */
export const sshMountOf = (mount: string | undefined): string =>
  trimTrailingSlashes(mount ?? 'ssh');
