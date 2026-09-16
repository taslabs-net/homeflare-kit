/**
 * Extra ignores are a merge, not drift. Identity comparison rewrote generated
 * OpenAPI in a Worker/TanStack app (measured 2026-09-16).
 */
import { describe, expect, test } from 'bun:test';
import { type OxfmtConfig, problemsInOxfmt } from '../src/oxfmt.ts';

const preset: OxfmtConfig = {
  printWidth: 100,
  useTabs: false,
  singleQuote: true,
  semi: true,
  ignorePatterns: ['**/node_modules/**', '**/dist/**', '**/generated/**'],
};

describe('problemsInOxfmt', () => {
  test('an identical copy is fine', () => {
    expect(problemsInOxfmt(preset, preset)).toEqual([]);
  });

  test('extra ignores are allowed — that is how generated vendor OpenAPI stays untouched', () => {
    const theirs: OxfmtConfig = {
      ...preset,
      ignorePatterns: [...(preset.ignorePatterns ?? []), '**/src/generated/**'],
    };
    expect(problemsInOxfmt(preset, theirs)).toEqual([]);
  });

  test('dropping a house ignore is drift', () => {
    const theirs: OxfmtConfig = {
      ...preset,
      ignorePatterns: ['**/node_modules/**', '**/dist/**'],
    };
    expect(problemsInOxfmt(preset, theirs).join('\n')).toContain('**/generated/**');
  });

  test('a quote rewrite is still a problem — generated files are not the place to flip style', () => {
    const theirs: OxfmtConfig = { ...preset, singleQuote: false };
    expect(problemsInOxfmt(preset, theirs).join('\n')).toContain('singleQuote');
  });
});
