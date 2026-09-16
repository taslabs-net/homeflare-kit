/**
 * Library oxlint is not a Worker/TanStack app. --deny-warnings failed on
 * console.error (Workers Logs), Alchemy default export, test non-null
 * assertions, and a Kumo initials trigger (measured 2026-09-16).
 */
import { describe, expect, test } from 'bun:test';

type Oxlintrc = {
  readonly extends?: readonly string[];
  readonly rules?: Record<string, unknown>;
  readonly ignorePatterns?: readonly string[];
  readonly overrides?: readonly {
    readonly files: readonly string[];
    readonly rules: Record<string, unknown>;
  }[];
};

describe('oxlintrc.app.json', () => {
  test('extends the library preset and turns off the Worker/app collisions', async () => {
    const preset = (await Bun.file(
      new URL('../oxlintrc.app.json', import.meta.url),
    ).json()) as Oxlintrc;

    expect(preset.extends).toEqual(['./oxlintrc.json']);
    expect(preset.rules?.['import/no-default-export']).toBe('off');
    expect(preset.rules?.['jsx-a11y/control-has-associated-label']).toBe('off');
    expect(preset.ignorePatterns).toContain('**/generated/**');
    expect(preset.ignorePatterns).toContain('**/*.gen.ts');
    expect(preset.ignorePatterns).toContain('**/vendor/**');

    const src = preset.overrides?.find((o) => o.files.includes('src/**'));
    expect(src?.rules['no-console']).toBe('off');

    const tests = preset.overrides?.find((o) => o.files.includes('**/tests/**'));
    expect(tests?.rules['typescript/no-non-null-assertion']).toBe('off');
  });
});
