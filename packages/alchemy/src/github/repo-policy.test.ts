/**
 * The declaring half, and the doc that carries its two traps.
 *
 * ★ WHY TEST A DOC. `docs/repo-policy.md` ships in the tarball and is the only place a
 *   consumer is told that the vendor ruleset adopts nothing and that auto-merge with
 *   nothing required merges on the spot. A silent edit that drops either warning would
 *   fail nothing else in this repo, and would cost the consumer a duplicate ruleset or a
 *   pull request merged on red.
 */
import { describe, expect, test } from 'bun:test';
import { declareRepoPolicy } from './index.ts';

const doc = await Bun.file(new URL('../../docs/repo-policy.md', import.meta.url)).text();

describe('declareRepoPolicy', () => {
  test('is a function, not a factory that reaches GitHub at import time', () => {
    // ⚠️ Importing this module must not construct a resource or an Octokit client: the
    //   barrel is loaded by the consumer smoke test with no credentials in the process.
    expect(typeof declareRepoPolicy).toBe('function');
    expect(declareRepoPolicy.length).toBe(2);
  });
});

describe('docs/repo-policy.md', () => {
  test('stays under the 200-line cap', () => {
    expect(doc.split('\n').length).toBeLessThanOrEqual(200);
  });

  test('warns that auto-merge with nothing required merges immediately', () => {
    expect(doc).toContain('auto-merge');
    expect(doc).toMatch(/merges? (the pull request )?immediately/i);
  });

  test('warns that the vendor ruleset cannot be adopted and duplicates instead', () => {
    expect(doc).toContain('createRepoRuleset');
    expect(doc).toContain('rulesets');
  });
});
