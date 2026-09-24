/**
 * splitFormattingWarning() / formattingFixLine() — pure, so no fake Caddy is needed: the
 * behavior that matters is which warning(s) get pulled out and what the fix line says.
 */
import { describe, expect, test } from 'bun:test';
import { formattingFixLine, splitFormattingWarning } from './format-warnings.ts';

const FORMATTING = 'Caddyfile:1: Caddyfile input is not formatted';
const OTHER = 'Caddyfile:3: unrecognized directive: reverse_proxyy';

describe('splitFormattingWarning', () => {
  test('pulls the formatting warning out, leaving the rest untouched', () => {
    expect(splitFormattingWarning([OTHER, FORMATTING])).toEqual({
      formatting: [FORMATTING],
      rest: [OTHER],
    });
  });

  test('formatting is empty, and rest unchanged, when there is no formatting warning', () => {
    expect(splitFormattingWarning([OTHER])).toEqual({ formatting: [], rest: [OTHER] });
  });

  test('an empty list splits into no formatting warning and no rest', () => {
    expect(splitFormattingWarning([])).toEqual({ formatting: [], rest: [] });
  });

  test('matches by substring, so a differing file:line still counts as the formatting warning', () => {
    const elsewhere = '/etc/Caddyfile:42: Caddyfile input is not formatted';
    expect(splitFormattingWarning([elsewhere])).toEqual({ formatting: [elsewhere], rest: [] });
  });

  test('TWO formatting warnings (e.g. an unformatted import) both survive — neither is dropped', () => {
    // ⛔ Regression: a `.find()` here would keep only the first AND (via `.filter()`) strip the
    //   second out of `rest` too — silently discarding it from both branches at once.
    const second = '/etc/Caddyfile.d/site.caddy:1: Caddyfile input is not formatted';
    expect(splitFormattingWarning([FORMATTING, OTHER, second])).toEqual({
      formatting: [FORMATTING, second],
      rest: [OTHER],
    });
  });
});

describe('formattingFixLine', () => {
  test('names the endpoint and both fixes, never just the adapter’s own warning text', () => {
    const line = formattingFixLine('http://127.0.0.1:2019');
    expect(line).toContain('http://127.0.0.1:2019');
    expect(line).toContain('caddy fmt');
    expect(line).toContain('formatCaddyfile()');
  });
});
