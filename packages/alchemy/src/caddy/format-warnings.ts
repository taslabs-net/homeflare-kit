/**
 * Pulls Caddy's adapter "Caddyfile input is not formatted" warning(s) out of a warnings list, so
 * config.ts's reconcile (deploy) and config-reconcile.ts's diffConfig (plan) can show it as one
 * clear, actionable line instead of burying it among the rest.
 *
 * ★ THIS IS THE COMMON CASE, NOT AN EDGE ONE. admin-calls.ts's module doc: the Caddyfile adapter
 *   warns on EVERY unformatted input (adapter.go FormattingDifference) — every declared Caddyfile
 *   that was not run through `caddy fmt` (or format.ts's formatCaddyfile()) carries this warning
 *   on every plan and every deploy, indistinguishable from the rest unless split out.
 */

/** The exact adapter message (caddyserver/caddy v2.11.4, adapter.go FormattingDifference). */
const NOT_FORMATTED = 'Caddyfile input is not formatted';

export type SplitWarnings = {
  /**
   * Every warning THAT IS the formatting one — usually one, but an `import`ed file can add
   * another with its own file:line, and this keeps every one of them (never just the first): a
   * `.find()` here would silently drop the rest, not merely leave them uncounted.
   */
  readonly formatting: readonly string[];
  /** Every other warning, in order, formatting removed. */
  readonly rest: readonly string[];
};

/** Separates the formatting warning(s) (by substring, matching admin-calls.ts's `describe()`). */
export const splitFormattingWarning = (warnings: readonly string[]): SplitWarnings => ({
  formatting: warnings.filter((warning) => warning.includes(NOT_FORMATTED)),
  rest: warnings.filter((warning) => !warning.includes(NOT_FORMATTED)),
});

/**
 * One clear line naming the fix — never just the adapter's own warning text, and never repeated
 * per formatting warning: however many `formatting` holds, this is logged once (config.ts,
 * config-reconcile.ts), since restating the same fix N times is its own noise.
 */
export const formattingFixLine = (endpoint: string): string =>
  `Caddy.Config at ${endpoint}: Caddyfile is not formatted — run \`caddy fmt\` on it, or format ` +
  "it with this package's formatCaddyfile() before declaring it, to silence this warning.";
