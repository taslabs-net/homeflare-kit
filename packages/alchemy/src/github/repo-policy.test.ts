/**
 * The declaring half, and the two docs that carry its traps.
 *
 * ★ WHY TEST A DOC. Both files ship in the tarball and are the only place a consumer is
 *   told that the vendor ruleset adopts nothing and that auto-merge with nothing required
 *   merges on the spot. A silent edit that drops either warning would fail nothing else
 *   in this repo, and would cost the consumer a duplicate ruleset or a PR merged on red.
 * ⛔ THE HAZARDS LIVE IN A SIBLING FILE, AND THE POINTER IS TESTED TOO. Extracting them
 *   is only safe while `repo-policy.md` still sends the reader there; a dangling pointer
 *   would read as "no hazard" rather than as a broken link.
 */
import { describe, expect, test } from 'bun:test';
import { declareRepoPolicy } from './index.ts';

const doc = await Bun.file(new URL('../../docs/repo-policy.md', import.meta.url)).text();
const hazards = await Bun.file(
  new URL('../../docs/repo-policy-ruleset-hazards.md', import.meta.url),
).text();

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

  test('sends the reader to the ruleset hazards, which is where they now live', () => {
    expect(doc).toContain('repo-policy-ruleset-hazards.md');
    expect(doc).toMatch(/cannot be adopted/i);
  });
});

describe('docs/repo-policy-ruleset-hazards.md', () => {
  test('stays under the 200-line cap', () => {
    expect(hazards.split('\n').length).toBeLessThanOrEqual(200);
  });

  test('warns that the vendor ruleset cannot be adopted and duplicates instead', () => {
    expect(hazards).toContain('createRepoRuleset');
    expect(hazards).toContain('rulesets');
  });

  test('carries the preflight that keeps a first deploy from duplicating', () => {
    expect(hazards).toContain('gh api repos/<owner>/<repo>/rulesets');
  });
});
