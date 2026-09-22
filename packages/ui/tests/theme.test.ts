/**
 * The theme is DATA, and these assert the derived outputs stay in step with it.
 *
 * ★ WHY YAML AND NOT A STYLESHEET ALONE. Measured 2026-09-15: `#f6821f` is hardcoded in
 *   37 files across the estate, and many are TSX — OG-image routes, admin widgets, email
 *   templates — which CSS cannot reach. One source, two generated outputs.
 * ⚠️ Parsed with `Bun.YAML.parse`: native, so no `yaml` dependency anywhere.
 */
import { describe, expect, test } from 'bun:test';
import { ACCENT, ACCENT_HOVER, ACCENT_INK } from '../src/theme.ts';

const root = new URL('../', import.meta.url);
const theme = Bun.YAML.parse(await Bun.file(new URL('theme/homeflare.yaml', root)).text()) as {
  brand: Record<string, string>;
  kumo: Record<string, string>;
};

describe('theme', () => {
  test('the TS module matches the YAML', () => {
    // ⛔ If these drift, a Worker renders one orange and the stylesheet another.
    expect(ACCENT).toBe(theme.brand['accent'] ?? '');
    expect(ACCENT_HOVER).toBe(theme.brand['accentHover'] ?? '');
    expect(ACCENT_INK.light).toBe(theme.brand['inkLight'] ?? '');
    expect(ACCENT_INK.dark).toBe(theme.brand['inkDark'] ?? '');
  });

  test('the stylesheet matches the YAML', async () => {
    const css = await Bun.file(new URL('styles/index.css', root)).text();

    // ⛔ Kumo's default brand is BLUE. Without this override primary buttons stay blue —
    //   the defect an outside review caught in 0.2.0.
    expect(css).toContain(`--color-kumo-brand: ${theme.kumo['color-kumo-brand'] ?? ''}`);
    expect(css).toContain(`--hf-accent: ${theme.brand['accent'] ?? ''}`);
    expect(css).toContain(
      `light-dark(${theme.brand['inkLight'] ?? ''}, ${theme.brand['inkDark'] ?? ''})`,
    );
  });

  test('regenerating produces no diff, so the outputs are committed in sync', async () => {
    const before = await Bun.file(new URL('styles/index.css', root)).text();

    const proc = Bun.spawn(['bun', 'run', 'scripts/build-theme.ts'], {
      cwd: root.pathname,
      stdout: 'ignore',
      stderr: 'ignore',
    });
    await proc.exited;

    // ⚠️ A generated file that is committed stale is the failure mode here: the build
    //   would fix it silently on the next release, so nothing would ever report it.
    expect(await Bun.file(new URL('styles/index.css', root)).text()).toBe(before);
  });

  test('text ink is never the raw accent — it fails contrast', () => {
    // 🔴 #f6821f on white is below WCAG AA at body sizes. Shipping it as text colour is
    //   an accessibility defect, which is why the two values are separate at all.
    expect(ACCENT_INK.light).not.toBe(ACCENT);
    expect(ACCENT_INK.dark).not.toBe(ACCENT);
  });
});
