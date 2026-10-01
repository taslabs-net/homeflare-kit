/**
 * How the hooks read gitleaks's stderr (gitleaks.ts): which lines mean "gitleaks, or the git
 * under it, failed" and which are only text.
 *
 * ★ THE SHAPES ARE 8.30.1's, read from a real run with `--no-color`: `<time> <LEVEL> <message>`,
 *   with git's own words logged `<time> ERR [git] fatal: …`. A finding is `WRN leaks found: N`
 *   and its file path goes to STDOUT, never into these lines, so a path with `[git]` in it can
 *   reach stderr only through a message or a debug line.
 */
import { describe, expect, test } from 'bun:test';
import { brokenLine } from '../src/hooks/gitleaks.ts';

const ESC = String.fromCharCode(27);

describe('lines that mean the scan did not happen', () => {
  test.each([
    ['git failing', '2:30PM ERR [git] fatal: bad object deadbeef'],
    ['the summary of a failure', '2:30PM ERR error="stderr is not empty"'],
    ['a fatal', '2:30PM FTL could not read the config'],
    ['a panic', '2:30PM PNC unexpected'],
    ["git's own words at any level", '2:30PM WRN [git] warning: something'],
  ])('%s', (_name, line) => {
    expect(brokenLine(`2:30PM INF 0 commits scanned.\n${line}\n2:30PM INF no leaks found`)).toBe(
      line,
    );
  });

  test('colour codes around the level do not hide it', () => {
    const coloured = `${ESC}[90m2:30PM${ESC}[0m ${ESC}[1m${ESC}[31mERR${ESC}[0m [git] fatal: x`;
    expect(brokenLine(coloured)).toBe('2:30PM ERR [git] fatal: x');
  });
});

describe('lines that are only text', () => {
  test.each([
    ['a finding', '2:30PM WRN leaks found: 1'],
    ['a message naming a path with [git] in it', '2:30PM WRN skipping docs/[git]/notes.md: big'],
    [
      'a debug line with a directory called [git]',
      '2:30PM DBG executing: git -C /home/x/[git]/p log',
    ],
    ['an info line', '2:30PM INF 3 commits scanned.'],
    ['an ERR-looking word inside a message', '2:30PM INF scanned a file named ERR.txt'],
  ])('%s', (_name, line) => {
    expect(brokenLine(line)).toBeUndefined();
  });

  test('nothing said, nothing broken', () => {
    expect(brokenLine('')).toBeUndefined();
  });
});
