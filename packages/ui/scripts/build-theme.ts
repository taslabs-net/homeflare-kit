/**
 * Generate styles/index.css and src/theme.ts from theme/homeflare.yaml.
 *
 * ★ ONE SOURCE. `#f6821f` is hardcoded in 37 files across the estate (measured
 *   2026-09-15), and they are not all CSS: OG-image routes, admin widgets and email
 *   templates are TSX, which a stylesheet cannot reach. So the theme is DATA, and both a
 *   stylesheet and a TypeScript module are derived from it.
 *
 * ⚠️ `Bun.YAML.parse` — native, no `yaml` dependency in the build or in a consumer.
 *
 * ⛔ THE OUTPUTS ARE GENERATED. Never hand-edit styles/index.css or src/theme.ts; change
 *   the YAML and re-run. A test asserts all three agree, so drift fails CI rather than
 *   shipping a stylesheet and a TS constant that disagree about the brand colour.
 */
type Theme = {
  readonly brand: Record<string, string>;
  readonly kumo: Record<string, string>;
  readonly layout: Record<string, string>;
};

const here = new URL('../', import.meta.url);
const theme = Bun.YAML.parse(await Bun.file(new URL('theme/homeflare.yaml', here)).text()) as Theme;

const vars = [
  ...Object.entries(theme.kumo).map(([k, v]) => `  --${k}: ${v};`),
  '',
  `  /** Brand orange. ⛔ FILLS AND BORDERS ONLY — see --hf-accent-ink. */`,
  `  --hf-accent: ${theme.brand['accent'] ?? ''};`,
  '',
  `  /**`,
  `   * ⛔ USE FOR ANY ORANGE TEXT, never --hf-accent. The raw brand fails WCAG contrast`,
  `   *   on a light background at body sizes.`,
  `   * ★ light-dark() rather than a dark: variant, so it follows the OS scheme via`,
  `   *   color-scheme above and needs no class plumbing.`,
  `   */`,
  `  --hf-accent-ink: light-dark(${theme.brand['inkLight'] ?? ''}, ${theme.brand['inkDark'] ?? ''});`,
  '',
  ...Object.entries(theme.layout).map(([k, v]) => `  --${k}: ${v};`),
].join('\n');

const css = `/**
 * @homeflare/ui/styles — Kumo, themed for HomeFlare.
 *
 * ⛔ GENERATED from theme/homeflare.yaml by scripts/build-theme.ts. Do not hand-edit:
 *   change the YAML and re-run \`bun run build:theme\`.
 *
 * Import ONCE, at your app root:
 *     import '@homeflare/ui/styles';
 *
 * ⛔ OPT-IN, NEVER AUTOMATIC. The JS entrypoint imports no CSS: a library that does so on
 *   your behalf breaks any consumer whose bundler cannot handle CSS imports — a Worker
 *   bundling for workerd, or an SSR pass loading the module for its types.
 *
 * ★ This replaces \`import '@cloudflare/kumo/styles'\`: Kumo's stylesheet first, then the
 *   HomeFlare theme over it.
 * ⛔ Kumo's default brand is BLUE. The --color-kumo-brand overrides below are what make
 *   primary buttons orange, and \`bg-kumo-brand\` resolves them at the use site — so no
 *   component needs touching.
 */
@import '@cloudflare/kumo/styles';

:root {
  color-scheme: light dark;

${vars}
}

/**
 * Unclassed anchors pick up the brand. Kumo components style their own links, so this
 * only reaches prose — and it uses the contrast-safe ink, not the raw accent.
 */
a:not([class]) {
  color: var(--hf-accent-ink);
}
`;

const ts = `/**
 * The HomeFlare theme, for code a stylesheet cannot reach.
 *
 * ⛔ GENERATED from theme/homeflare.yaml by scripts/build-theme.ts. Do not hand-edit.
 *
 * ★ OG-image routes, admin widgets and email templates are TSX and need these values as
 *   strings. They import from here; \`@homeflare/ui/styles\` covers everything that is CSS.
 *   Both come from the same YAML, so they cannot disagree.
 */

/** Brand orange. ⛔ FILLS AND BORDERS ONLY — use \`ACCENT_INK\` for text. */
export const ACCENT: string = '${theme.brand['accent'] ?? ''}';

/** Hover state for brand fills. */
export const ACCENT_HOVER: string = '${theme.brand['accentHover'] ?? ''}';

/**
 * ⛔ USE FOR ANY ORANGE TEXT. \`ACCENT\` on a light background fails WCAG contrast at body
 *   sizes; these are darkened for light mode and lightened for dark.
 */
export const ACCENT_INK: { readonly light: string; readonly dark: string } = {
  light: '${theme.brand['inkLight'] ?? ''}',
  dark: '${theme.brand['inkDark'] ?? ''}',
};
`;

await Bun.write(new URL('styles/index.css', here), css);
await Bun.write(new URL('src/theme.ts', here), ts);
console.log('theme: styles/index.css and src/theme.ts regenerated from theme/homeflare.yaml');
