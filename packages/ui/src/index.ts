/**
 * @homeflare/ui — shared brand tokens and HomeFlare-specific compositions for apps built
 * on Cloudflare Kumo.
 *
 * ⛔ KUMO IS NOT RE-EXPORTED, AND THAT IS DELIBERATE. Import its components directly and
 *   granularly:
 *       import { Button } from '@cloudflare/kumo/components/button';
 *   ★ Re-exporting would put all 44 components in the module graph, so an app that uses a
 *     Button ships the chart library. Kumo's own docs point at the per-component
 *     subpaths, and a barrel in front of them defeats that.
 *   ⚠️ It also means Kumo is a PEER here, not a dependency: consumers import it directly,
 *     so they must declare it, and one copy must win. A dependency would let two Kumo
 *     versions coexist in one tree — two stylesheets, two Base UI instances.
 *
 * ⛔ THIS ENTRYPOINT IMPORTS NO CSS. Styles are opt-in at `@homeflare/ui/styles`, because
 *   a library that imports CSS on your behalf breaks any consumer whose bundler does not
 *   handle CSS imports — including a Worker bundling for workerd, and any server-side
 *   render that loads this module.
 *
 * ★ WHAT BELONGS HERE: compositions of Kumo parts that more than one HomeFlare app needs,
 *   never reimplementations of a Kumo component. If Kumo has it, use Kumo's.
 */

export { VERSION } from './version.ts';

// ★ For code a stylesheet cannot reach — OG images, admin widgets, email templates.
//   Generated from theme/homeflare.yaml, the same source as the stylesheet.
export { ACCENT, ACCENT_HOVER, ACCENT_INK } from './theme.ts';
