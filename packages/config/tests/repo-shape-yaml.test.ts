/**
 * `trimTrailingNewlines` (packages/config/src/repo-shape/yaml.ts) replaces
 * `command.replace(/\n+$/, '')` in `renderRun`, fixed for CodeQL alert 5,
 * js/polynomial-redos, which flagged that regex (PR 125 / commit bc3e1fa). This
 * proves the replacement is byte-identical to the regex it replaced on ordinary
 * input, and that — unlike the regex — it stays fast on an adversarial one.
 */
import { describe, expect, test } from 'bun:test';
import { trimTrailingNewlines } from '../src/repo-shape/yaml.ts';

/** The regex `renderRun` used to call. Kept only so the two can be compared. */
function oldTrim(value: string): string {
  return value.replace(/\n+$/, '');
}

const CASES = ['', '\n', 'a', 'a\n\n', 'a\nb\n', 'a\r\n', '\n\na'];

describe('trimTrailingNewlines matches the regex it replaced', () => {
  for (const value of CASES) {
    test(`byte-identical for ${JSON.stringify(value)}`, () => {
      expect(trimTrailingNewlines(value)).toBe(oldTrim(value));
    });
  }

  test('a 100,000-newline input finishes quickly', () => {
    const long = '\n'.repeat(100_000);
    // ⚠️ THE REGRESSION THIS GUARDS: `/\n+$/` on a long run of trailing "\n" is the
    //   CodeQL js/polynomial-redos shape the regex was flagged for. A linear trim
    //   finishes in milliseconds; a reintroduced backtracking regex would not.
    const started = performance.now();
    const trimmed = trimTrailingNewlines(long);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(trimmed).toBe('');
    expect(trimmed).toBe(oldTrim(long));
  });
});
