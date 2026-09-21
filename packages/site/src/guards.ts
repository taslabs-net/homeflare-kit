/**
 * Guards that refuse a plan before it can touch the wrong thing.
 *
 * ⛔ EACH ONE FAILS CLOSED. A guard that warns is a guard nobody reads in a CI log.
 */
import { SiteError } from './errors.ts';
import type { Site } from './schema.ts';

/**
 * Refuse a site reviewed against a different `@homeflare/site` than the one installed.
 *
 * ★ WHY EXACT EQUALITY. Derive rules are this package's behaviour. If a new version builds
 *   one hostname differently, every repo on it would plan a rename — a REPLACE — without
 *   anyone having looked. Holding `deriveVersion` equal to the installed version makes that
 *   a deliberate, reviewed one-line bump in the site file instead.
 */
export function checkDeriveVersion(site: Site, installed: string): void {
  if (site.deriveVersion === installed) return;
  throw new SiteError(
    'derive-version',
    `the site file was reviewed against @homeflare/site ${site.deriveVersion}, ` +
      `but ${installed} is installed. Read the CHANGELOG between them for derive changes, ` +
      `then set "deriveVersion": "${installed}" — or install ${site.deriveVersion}.`,
  );
}

/** Stages as a deploy tool names them. Only `live` is special here. */
export type Stage = string;

/**
 * ⛔ STAGE `live` ONLY WITH A LIVE SITE. An example or testing site can never plan
 *   against live state — its account ids and cluster name are placeholders, and a plan
 *   against real state would read every live object as "not declared: delete".
 */
export function assertStage(site: Site, stage: Stage): void {
  if (stage !== 'live' || site.kind === 'live') return;
  throw new SiteError(
    'stage',
    `stage "live" needs a live site; this one is kind "${site.kind}". ` +
      `Point HF_SITE_FILE at the live site file, or plan a non-live stage.`,
  );
}
