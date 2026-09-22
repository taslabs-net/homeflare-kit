/**
 * The bin's two pure halves: its flags (args.ts) and its text (report.ts).
 *
 * ⛔ NO STAGE IS GUESSED. Alchemy defaults `--stage` to `live_$USER`; a gate that verified that by
 *   accident would pass while the real stage went unchecked, so a missing stage is an error here.
 */
import { describe, expect, test } from 'bun:test';
import { parseVerifyArgs } from './args.ts';
import { exitCodeOf, formatReport } from './report.ts';
import type { AdoptRow } from './rows.ts';
import type { AdoptReport } from './verify.ts';

describe('parseVerifyArgs', () => {
  test('takes the flags alchemy plan takes', () => {
    const parsed = parseVerifyArgs(
      ['-c', 'alchemy.pbs.ts', '--stage', 'live', '--profile', 'p', '--env-file', '.env', '--all'],
      {},
    );
    expect(parsed).toEqual({
      json: false,
      kind: 'run',
      options: { all: true },
      target: { entrypoint: 'alchemy.pbs.ts', envFile: '.env', profile: 'p', stage: 'live' },
    });
  });

  test('defaults the entrypoint and reads ALCHEMY_STAGE, but never guesses a stage', () => {
    const parsed = parseVerifyArgs(['--json'], { ALCHEMY_STAGE: 'live' });
    expect(parsed).toMatchObject({ json: true, target: { entrypoint: 'alchemy.run.ts' } });
    expect(parseVerifyArgs([], { USER: 'tim' })).toMatchObject({ kind: 'error' });
  });

  test('an unknown flag or a positional is an error, and --help is help', () => {
    expect(parseVerifyArgs(['--stage', 'live', '--yes'], {})).toMatchObject({ kind: 'error' });
    expect(parseVerifyArgs(['--stage', 'live', 'alchemy.run.ts'], {})).toMatchObject({
      kind: 'error',
    });
    expect(parseVerifyArgs(['-h'], {})).toEqual({ kind: 'help' });
  });
});

const row = (over: Partial<AdoptRow>): AdoptRow => ({
  bindings: 0,
  changed: [],
  diff: 'noop',
  fqn: 'lab',
  ok: true,
  planned: 'adopted',
  read: 'found',
  stateRow: false,
  type: 'Proxmox.Pool',
  why: '',
  ...over,
});

const report = (rows: AdoptRow[]): AdoptReport => ({
  declared: 5,
  rows,
  stack: 'HomeFlareProxmox',
  stage: 'live',
});

describe('formatReport', () => {
  test('a clean report exits 0 and says so', () => {
    const clean = report([row({})]);
    expect(exitCodeOf(clean)).toBe(0);
    expect(formatReport(clean, false)).toContain('every row is a no-op');
  });

  test('a failing row exits 1, shows its reason and field names, never values', () => {
    const dirty = report([
      row({ changed: ['comment'], diff: 'update', ok: false, why: 'the deploy writes' }),
    ]);
    const text = formatReport(dirty, false);
    expect(exitCodeOf(dirty)).toBe(1);
    expect(text).toContain('FAIL');
    expect(text).toContain('changed: comment');
    expect(text).toContain('the deploy writes');
    expect(text).toContain('1 row(s) are NOT a no-op');
  });

  test('nothing to verify is a pass that says why', () => {
    expect(formatReport(report([]), false)).toContain('every declared row already has state');
    expect(exitCodeOf(report([]))).toBe(0);
  });
});
