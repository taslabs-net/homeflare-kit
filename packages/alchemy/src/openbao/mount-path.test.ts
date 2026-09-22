/**
 * Slash trimming stays linear on caller input (CodeQL js/polynomial-redos).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { trimRuns, trimSlashes, trimTrailingSlashes } from './mount-path.ts';

describe('mount-path', () => {
  it('trims outer slashes and keeps inner ones', () => {
    assert.equal(trimSlashes('/team/approle/'), 'team/approle');
    assert.equal(trimSlashes('///'), '');
    assert.equal(trimTrailingSlashes('/ssh-host//'), '/ssh-host');
    assert.equal(trimTrailingSlashes('ssh'), 'ssh');
  });

  it('handles a long run of slashes before other text in linear time', () => {
    const run = '/'.repeat(200_000);
    const started = performance.now();
    assert.equal(trimTrailingSlashes(`${run}x`), `${run}x`);
    assert.equal(trimSlashes(`${run}x${run}`), 'x');
    assert.ok(performance.now() - started < 1_000, 'slash trimming took over a second');
  });
});

describe('trimRuns', () => {
  it('trims any single character and stays linear on long runs', () => {
    assert.equal(trimRuns('--a-b--', '-'), 'a-b');
    const run = '-'.repeat(200_000);
    const started = performance.now();
    assert.equal(trimRuns(`${run}x${run}y`, '-'), `x${run}y`);
    assert.ok(performance.now() - started < 1_000, 'trimming took over a second');
  });
});
