/**
 * @homeflare/site — one typed site config, and every name derived from it.
 *
 * ★ WHY. A public stack that types a hostname cannot be run by anyone else, and a stack
 *   that re-derives a name its own way drifts from its siblings. Here the site file holds
 *   the base values once; `derive()` builds every hostname, address and mount name the
 *   same way in every repo; and names that must never follow a rule are PINNED.
 *
 *     import { decodeSite, derive } from '@homeflare/site';        // runtime-neutral
 *     import { loadSite } from '@homeflare/site/load';              // Node / Bun: HF_SITE_FILE
 *
 * ⛔ RUNTIME-NEUTRAL. Nothing reachable from this file touches `node:*`, `bun:*`, the
 *   filesystem or the environment. File and env reading live in `./load.ts`.
 */
export { VERSION } from './version.ts';
export { SiteError, type SiteErrorCode } from './errors.ts';
export { SITE_FORMAT, type Site, type SiteInput, SiteSchema } from './schema.ts';
export { type ValidateOptions, decodeSite, validateSite } from './decode.ts';
export {
  type Derived,
  type DerivedAccess,
  type DerivedHost,
  type DerivedVault,
  derive,
} from './derive.ts';
export { type Pins, pins } from './pins.ts';
export { inventory, pinnedPrincipalIssues, unknownPrincipals } from './inventory.ts';
export { type Stage, assertStage, checkDeriveVersion } from './guards.ts';
export {
  type ExpectedIdentityOptions,
  type Identity,
  type IdentityMismatch,
  assertIdentity,
  compareIdentity,
  expectedIdentity,
} from './identity.ts';
export {
  SITE_TOKENS,
  type SiteToken,
  type ValuedToken,
  renderTokens,
  tokenValues,
} from './tokens.ts';
