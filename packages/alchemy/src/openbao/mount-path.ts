/**
 * Slash trimming for caller-supplied mount paths.
 *
 * ★ LOOPS, NOT `/^\/+|\/+$/g` OR `/\/+$/`. A trailing `\/+$` backtracks polynomially on a long run
 *   of `/` followed by anything else (CodeQL js/polynomial-redos), and mount paths are caller input.
 *   Both loops are linear in the input length.
 */

/** `text` without trailing `/`. */
export const trimTrailingSlashes = (text: string): string => {
  let end = text.length;
  while (end > 0 && text[end - 1] === '/') end -= 1;
  return text.slice(0, end);
};

/** `text` without leading or trailing `/`. */
export const trimSlashes = (text: string): string => {
  let start = 0;
  while (start < text.length && text[start] === '/') start += 1;
  return trimTrailingSlashes(text.slice(start));
};

/** SSH mount path without a trailing slash; `ssh` when the caller did not say. */
export const sshMountOf = (mount: string | undefined): string =>
  trimTrailingSlashes(mount ?? 'ssh');
