/**
 * The HomeFlare theme, for code a stylesheet cannot reach.
 *
 * ⛔ GENERATED from theme/homeflare.yaml by scripts/build-theme.ts. Do not hand-edit.
 *
 * ★ OG-image routes, admin widgets and email templates are TSX and need these values as
 *   strings. They import from here; `@homeflare/ui/styles` covers everything that is CSS.
 *   Both come from the same YAML, so they cannot disagree.
 */

/** Brand orange. ⛔ FILLS AND BORDERS ONLY — use `ACCENT_INK` for text. */
export const ACCENT: string = '#f6821f';

/** Hover state for brand fills. */
export const ACCENT_HOVER: string = '#e0700f';

/**
 * ⛔ USE FOR ANY ORANGE TEXT. `ACCENT` on a light background fails WCAG contrast at body
 *   sizes; these are darkened for light mode and lightened for dark.
 */
export const ACCENT_INK: { readonly light: string; readonly dark: string } = {
  light: '#c2570a',
  dark: '#fbad41',
};
