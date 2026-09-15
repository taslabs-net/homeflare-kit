/**
 * @homeflare/ui — shared React components, built on Cloudflare Kumo.
 *
 * ★ KUMO IS THE DESIGN SYSTEM, NOT A STARTING POINT TO WRAP. It ships 44 accessible
 *   components on Base UI plus its own stylesheet (measured 2026-09-15: 102 export
 *   subpaths). This package exists for what Kumo does NOT have — HomeFlare-specific
 *   compositions. A component here composes Kumo parts; it never reimplements one.
 *   ⛔ THIS IS WHY SHADCN IS NOT IN THIS REPO. Kumo already occupies that layer, on Base
 *     UI rather than Radix. Taking both would mean two primitive libraries, two styling
 *     conventions and two a11y models in one app.
 *
 * ⛔ CONSUMERS IMPORT KUMO'S STYLESHEET THEMSELVES, once, at their app root:
 *       import '@cloudflare/kumo/styles';
 *   ⚠️ A library that imports CSS on your behalf breaks any consumer whose bundler does
 *     not handle CSS imports — including a Worker bundling for workerd.
 *
 * ★ KUMO IS RE-EXPORTED HERE so an app has ONE import for its UI layer. That is the DRY
 *   this package is for: when Kumo's version moves, it moves in this package's
 *   dependency, not in every app's manifest.
 */

// ⚠️ NOT `export * from '@cloudflare/kumo'`. The root entry pulls all 44 components into
//   the module graph; Kumo's own docs point at the per-component subpaths for
//   tree-shaking, and an app that uses a Button should not ship the chart library.
//   Apps import components directly from '@cloudflare/kumo/components/<name>'.
export { VERSION } from './version.ts';
