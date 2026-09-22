/**
 * `@homeflare/config/versions`: the one aligned set of versions the estate runs.
 *
 *     import { ESTATE_VERSIONS } from '@homeflare/config/versions';
 *     ESTATE_VERSIONS.alchemy; // '2.0.0-beta.79'
 *
 * ★ WHY IT LIVES HERE. Until this file, the set had two homes and neither was reachable from
 *   outside the kit. Bun was `BUN_VERSION` in repo-shape/ci.ts. Every other pin sat in
 *   homeflare-kit's root `catalog`, which is authoritative but never published. Measured
 *   2026-09-22, read-only, from each repository's lockfile: seven app repositories resolve
 *   `alchemy` 2.0.0-beta.78, the monorepo resolves beta.77 with `effect` rc.112, and one app
 *   resolves TypeScript 5.9.3. None of them had anything to compare against.
 *   `@homeflare/config` is the one package almost every estate repository already depends
 *   on (repo-shape.ts header: 13 of 14), so the set goes here.
 *
 * ⛔ THE KIT'S ROOT CATALOG STAYS AUTHORITATIVE. `tests/estate-versions.test.ts` fails when any
 *   value below differs from it, and it also fails when `bun` differs from `BUN_VERSION` or
 *   from the root's `packageManager`. A catalog bump that does not reach this file is
 *   therefore a red test in the same PR. Otherwise the estate would drift from a published
 *   source that looks correct.
 *
 * ★ RUNTIME PINS FOLLOW THE PINNED ALCHEMY RELEASE, NEVER THE OTHER WAY. `effect` and
 *   `@distilled.cloud/cloudflare` are the versions `alchemy@2.0.0-beta.79` was built and
 *   tested against. That release's own `dependencies` pin every `@distilled.cloud/*` at
 *   exactly 1.0.0-rc.12, and its workspace overrides pin `effect` 4.0.0-rc.115
 *   (alchemy-run/alchemy `pnpm-workspace.yaml@v2.0.0-beta.79#overrides`). The test reads the
 *   installed `alchemy/package.json` to prove the distilled pin. These values move only in
 *   the same PR as the `alchemy` bump.
 *
 * ⚠️ PUBLISHING THE SET ENFORCES NOTHING. No consumer check reads it yet. Wiring it into
 *   `checkProject`, so that each repository's lockfile is compared with it, is a separate,
 *   estate-wide rollout. Doing that here would turn the next bump into thirteen red CIs at
 *   once.
 */
import { BUN_VERSION } from './repo-shape/ci.ts';

/** The package names the set pins. One entry per tool or runtime the whole estate shares. */
export type EstatePackage =
  | 'bun'
  | 'alchemy'
  | 'effect'
  | '@distilled.cloud/cloudflare'
  | 'typescript'
  | 'oxfmt'
  | 'oxlint'
  | '@types/bun';

/**
 * Exact versions, never ranges. A range is what lets two repositories resolve two different
 * versions from one line, which is exactly the drift this set exists to name.
 */
export const ESTATE_VERSIONS: Readonly<Record<EstatePackage, string>> = {
  bun: BUN_VERSION,
  alchemy: '2.0.0-beta.79',
  effect: '4.0.0-rc.115',
  '@distilled.cloud/cloudflare': '1.0.0-rc.12',
  typescript: '7.0.2',
  oxfmt: '0.68.0',
  oxlint: '1.83.0',
  '@types/bun': '1.4.2',
};
