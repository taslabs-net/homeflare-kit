/**
 * The placeholders public docs use instead of estate values.
 *
 * ⛔ A PUBLIC DOC NEVER NAMES A LIVE VALUE. It writes `<vault-host>`, and anyone reading
 *   it substitutes their own. `tokenValues(site)` is that substitution for one site; a
 *   leak gate builds its needles from `tokenValues(liveSite)` in memory, so the live
 *   values never have to be written down anywhere else.
 *
 * ★ `<cluster>` HAS NO SINGLE VALUE. It stands for any key of `site.clusters` (as
 *   `<alias>` and `<surface>` do inside `cloudflare-<alias>-<surface>`), so it is listed
 *   for doc lint but never substituted.
 */
import { derive } from './derive.ts';
import type { Site } from './schema.ts';

export const SITE_TOKENS = {
  '<apex>': 'the apex domain every derived name hangs off',
  '<vault-host>': 'the vault UI hostname: <vault label>.<apex>',
  '<vault-api-host>': 'the vault public API hostname: <api label>.<vault-host>',
  '<mgmt-zone>': 'the management zone: <mgmt label>.<apex>',
  '<access-team>': 'the Cloudflare Access team name (<access-team>.cloudflareaccess.com)',
  '<github-owner>': 'the GitHub user or organisation that owns the repos',
  '<estate-root>': 'the absolute directory holding host-local estate files',
  '<cluster>': 'any key of site.clusters — a variable, never substituted',
} as const;

export type SiteToken = keyof typeof SITE_TOKENS;

/** Tokens with exactly one value per site. */
export type ValuedToken = Exclude<SiteToken, '<cluster>'>;

/** Each single-valued token's value for `site`. */
export function tokenValues(site: Site): Readonly<Record<ValuedToken, string>> {
  const derived = derive(site);
  return {
    '<apex>': site.apex,
    '<vault-host>': derived.vault.host,
    '<vault-api-host>': derived.vault.apiHost,
    '<mgmt-zone>': derived.mgmtZone,
    '<access-team>': site.cloudflare.access.team,
    '<github-owner>': site.github.owner,
    '<estate-root>': site.paths.estateRoot,
  };
}

/**
 * Replace every single-valued token in `text` with its value for `site`.
 * ★ Longest token first, so a future token that contains another is never half-replaced.
 */
export function renderTokens(text: string, site: Site): string {
  const values = Object.entries(tokenValues(site)).sort(([a], [b]) => b.length - a.length);
  let out = text;
  for (const [token, value] of values) out = out.replaceAll(token, value);
  return out;
}
