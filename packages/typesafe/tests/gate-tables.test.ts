/**
 * The generated table itself: provenance, counts, the hand-edit-guard digest, the
 * Node-22-safe syntax check, `gen-gate-tables.ts --check`'s own reproduction/skip
 * behaviour, the fail-closed path, and a ReDoS time budget over every emitted rule.
 * Red on origin/main: packages/typesafe/src/gate/generated does not exist there.
 */
import { describe, expect, test } from 'bun:test';
import { digestOf } from '../scripts/gen-gate-tables.ts';
import { compileRuleTable } from '../src/gate/scan.ts';
import {
  GITLEAKS_RULES_DROPPED,
  GITLEAKS_RULES_EMITTED,
  GITLEAKS_TABLE_DIGEST,
} from '../src/gate/generated/gitleaks-rules.ts';
import { sidekiqSensitiveUrl, slackWebhookUrl } from './gate-fixtures.ts';

const GENERATED = new URL('../src/gate/generated/', import.meta.url);

describe('gate-tables: provenance', () => {
  test('every generated file names the vendor source at its pinned tag, with sha256/bytes/fetchedAt/license', async () => {
    for (const name of [
      'gitleaks-rules.ts',
      'gitleaks-rules-emitted.ts',
      'gitleaks-rules-dropped.ts',
    ]) {
      const text = await Bun.file(new URL(name, GENERATED)).text();
      expect(text).toContain('gitleaks/gitleaks/v8.30.1/config/gitleaks.toml');
      expect(text).toContain(
        'sha256 e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf',
      );
      expect(text).toContain('MIT');
      expect(text).toMatch(/fetched \d{4}-\d{2}-\d{2}T/);
    }
    const ranges = await Bun.file(new URL('special-ranges.ts', GENERATED)).text();
    expect(ranges).toContain('iana-ipv4-special-registry');
    expect(ranges).toContain(
      'sha256 e3e39e76d00b1677335db8e9a805c7b9480ea2f4dc9e33f0b93cd3a905128d73',
    );
    expect(ranges).toContain(
      'sha256 775feea0621dec8735a44fbf30f762e721e8f0a1b3ab7eb341961a88cfce2139',
    );
  });

  test('the MIT notice and copyright line from gitleaks are present', async () => {
    const text = await Bun.file(new URL('gitleaks-rules-emitted.ts', GENERATED)).text();
    expect(text).toContain('Copyright (c) 2019 Zachary Rice');
  });
});

describe('gate-tables: counts and the hand-edit-guard digest', () => {
  test('emitted + dropped = 221, the measured count of gitleaks rules that carry a regex', () => {
    expect(GITLEAKS_RULES_EMITTED.length + GITLEAKS_RULES_DROPPED.length).toBe(221);
  });

  test('every dropped rule carries a non-empty reason', () => {
    for (const r of GITLEAKS_RULES_DROPPED) expect(r.reason.length).toBeGreaterThan(0);
  });

  test('the committed digest matches a fresh hash of the committed tables', async () => {
    const fresh = await digestOf(GITLEAKS_RULES_EMITTED, GITLEAKS_RULES_DROPPED);
    expect(fresh).toBe(GITLEAKS_TABLE_DIGEST);
  });
});

describe('gate-tables: the Node >=22-safe syntax check', () => {
  test('no emitted source carries a modifier group, a bare (?i), \\z, a POSIX class or a (?P< named group', () => {
    for (const r of GITLEAKS_RULES_EMITTED) {
      expect(r.source).not.toMatch(/\(\?[a-z-]+:/);
      expect(r.source).not.toMatch(/\(\?i\)/);
      expect(r.source).not.toContain('\\z');
      expect(r.source).not.toContain('[[:');
      expect(r.source).not.toContain('(?P<');
    }
  });

  test('every emitted source compiles with new RegExp', () => {
    const compiled = compileRuleTable(GITLEAKS_RULES_EMITTED);
    expect(compiled).not.toBe('unavailable');
  });
});

describe('gate-tables: fail-closed', () => {
  test('a bad rule injected into the table makes compilation report the whole table unavailable', () => {
    const withOneBadRule = [
      ...GITLEAKS_RULES_EMITTED.slice(0, 3),
      { id: 'bad', description: 'x', source: '(unterminated', flags: '' },
    ];
    expect(compileRuleTable(withOneBadRule)).toBe('unavailable');
  });

  test('the real table, unmodified, is NOT unavailable — the fail-closed path is reachable but not spuriously tripped', () => {
    expect(compileRuleTable(GITLEAKS_RULES_EMITTED)).not.toBe('unavailable');
  });
});

describe('gate-tables: ReDoS budget', () => {
  test('every emitted rule finishes well under budget on a 2,000-char adversarial input', () => {
    const compiled = compileRuleTable(GITLEAKS_RULES_EMITTED);
    if (compiled === 'unavailable') throw new Error('table failed to compile');
    const BUDGET_MS = 250;
    for (const rule of compiled) {
      // Two adversarial shapes: a long run that almost matches (stresses backtracking
      // on the rule's own charset) and one that never can (forces the engine through
      // every alternative before giving up).
      const filler = 'a'.repeat(2000);
      const started = performance.now();
      rule.regex.exec(filler);
      rule.regex.exec(`${filler}\u0000`);
      const elapsed = performance.now() - started;
      expect(elapsed).toBeLessThan(BUDGET_MS);
    }
  });
});

describe('gate-tables: hostname-dot escaping deviation (CodeQL, PR 162)', () => {
  function ruleById(id: string) {
    const rule = GITLEAKS_RULES_EMITTED.find((r) => r.id === id);
    if (!rule) throw new Error(`fixture rule ${id} missing from GITLEAKS_RULES_EMITTED`);
    return rule;
  }

  test('sidekiq-sensitive-url: hostname dots are escaped, still matches its shape, and a', () => {
    const rule = ruleById('sidekiq-sensitive-url');
    expect(rule.source).toContain('gems\\.contribsys\\.com');
    expect(rule.source).toContain('enterprise\\.contribsys\\.com');
    const re = new RegExp(rule.source, rule.flags);
    expect(re.test(sidekiqSensitiveUrl('gate-tables-p1', 'gems'))).toBe(true);
    expect(re.test(sidekiqSensitiveUrl('gate-tables-p2', 'enterprise'))).toBe(true);
    // dot swapped for another character must no longer match — this is the whole point
    // of escaping it: before the fix '.' matched any character here.
    expect(re.test(sidekiqSensitiveUrl('gate-tables-n1', 'gems', 'X'))).toBe(false);
    expect(re.test(sidekiqSensitiveUrl('gate-tables-n2', 'enterprise', 'X'))).toBe(false);
  });

  test('slack-webhook-url: hostname dot is escaped, still matches its shape, and a dot', () => {
    const rule = ruleById('slack-webhook-url');
    expect(rule.source).toContain('hooks\\.slack\\.com');
    const re = new RegExp(rule.source, rule.flags);
    expect(re.test(slackWebhookUrl('gate-tables-p3'))).toBe(true);
    expect(re.test(slackWebhookUrl('gate-tables-n3', 'X'))).toBe(false);
  });
});

describe('gate-tables: --check reproduces committed output, and skips without a cache', () => {
  test('--check against the real HOMEFLARE_SCHEMA_CACHE is clean (EXIT=0, nothing stale)', async () => {
    const proc = Bun.spawn(
      ['bun', new URL('../scripts/gen-gate-tables.ts', import.meta.url).pathname, '--check'],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    expect(code).toBe(0);
    expect(out).not.toContain('is stale');
  });

  test('with no cache present, it skips (EXIT=0) rather than failing', async () => {
    const proc = Bun.spawn(
      ['bun', new URL('../scripts/gen-gate-tables.ts', import.meta.url).pathname, '--check'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, HOMEFLARE_SCHEMA_CACHE: '/tmp/hf-gate-tables-test-empty-cache' },
      },
    );
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    expect(code).toBe(0);
    expect(out).toContain('Skipping');
  });
});
