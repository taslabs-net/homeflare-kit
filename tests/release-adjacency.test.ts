/**
 * Guards the rule that keeps a line a RELEASE rewrites away from a line a PULL REQUEST
 * edits — see scripts/hooks/release-adjacency.ts for the incident and docs/ci-triage.md
 * for the whole shape. In one sentence: a conflicted PR receives NO `pull_request`
 * workflow run, so its required checks are never reported and there is nothing red to
 * look at.
 *
 * ★ TWO DIFFERENT ENFORCEMENTS, BECAUSE TWO DIFFERENT FILES. package.json's key order is
 *   oxfmt's, not ours — measured 2026-09-22, it restores `name, version, description`
 *   from any position — so there the only lever is the pre-commit warning, and what a
 *   test can check is that the warning WORKS. site.example.json is a plain JSON file
 *   oxfmt leaves alone, so there the key order is ours to pin, and a test pins it.
 */
import { describe, expect, test } from 'bun:test';
import { adjacentEdits, changedLines } from '../scripts/hooks/release-adjacency.ts';

const root = new URL('../', import.meta.url);

describe('the pre-commit warning', () => {
  // 🔴 A CHECK THAT CANNOT FAIL IS WORSE THAN NO CHECK: it reads as coverage in CI and in
  //   review, so nobody looks again. This repo has shipped that defect twice (see
  //   tests/package-files.test.ts). So the detector is exercised, not just referenced.
  const manifest = [
    '{',
    '  "name": "@homeflare/x",',
    '  "version": "1.0.0",',
    '  "description": "…",',
    '  "homepage": "…",',
    '  "license": "MIT"',
    '}',
  ].join('\n');

  test('flags an edit on the line below "version"', () => {
    expect(adjacentEdits(manifest, [4])).toEqual([4]);
  });

  test('flags an edit on the line above "version"', () => {
    expect(adjacentEdits(manifest, [2])).toEqual([2]);
  });

  test('says nothing about an edit two lines away — measured CLEAN', () => {
    // ⚠️ The radius is exactly ONE line (git merge-file, git 2.55.0). Widening this
    //   would warn on every `homepage` or `license` edit for no measured reason.
    expect(adjacentEdits(manifest, [5, 6])).toEqual([]);
  });

  test('does not warn the release bot about its own "version" line', () => {
    expect(adjacentEdits(manifest, [3])).toEqual([]);
  });

  test('reads hunk headers, including a pure deletion', () => {
    expect(changedLines('@@ -4,1 +4,2 @@\n@@ -9,3 +10,0 @@')).toEqual([4, 5, 10, 11]);
  });
});

test('nothing hand-edited sits next to site.example.json\'s "deriveVersion"', async () => {
  // ⚠️ THE SAME SHAPE IN A SECOND FILE, PINNED BEFORE IT COSTS ANYTHING. Releasing
  //   @homeflare/site rewrites `deriveVersion` here via scripts/sync-versions.ts, exactly
  //   as changesets rewrites `"version"` in a manifest. `"version": 1` above it is the
  //   config SCHEMA version, which moves only on a breaking change to the shape, and
  //   `"kind"` below it has never been edited. Put a hand-maintained key between them and
  //   the next @homeflare/site release conflicts the way PR #111 did.
  // ⛔ oxfmt does NOT reorder a plain .json file — measured 2026-09-22 — so unlike a
  //   manifest this order is ours to keep, and nothing but this test keeps it.
  const text = await Bun.file(new URL('packages/site/site.example.json', root)).text();
  const lines = text.split('\n');
  const at = lines.findIndex((line) => line.startsWith('  "deriveVersion":'));

  expect(at).toBeGreaterThan(-1);
  expect([lines[at - 1], lines[at + 1]].map((line) => /^ {2}"([^"]+)":/.exec(line ?? '')?.[1])) //
    .toEqual(['version', 'kind']);
});
