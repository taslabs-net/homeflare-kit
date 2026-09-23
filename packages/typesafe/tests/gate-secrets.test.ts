/**
 * Secret-SHAPED content: gitleaks-derived prefix rules, entropy, addresses and
 * hostnames — every fixture built at runtime by gate-fixtures.ts, never written as a
 * literal contiguous secret shape (see that file's header for why). Red on
 * origin/main: packages/typesafe/src/gate does not exist there.
 *
 * ⛔ No test here inspects a MATCHED secret substring. Every assertion checks the
 *   refusal's `reason`/`rule` and that `JSON.stringify(result)` contains no 8-character
 *   substring of the fixture that tripped it — that width is enough to prove no
 *   meaningful fragment of the secret leaked into the result, without asserting the
 *   whole string is absent (which trivially over-fits a fixture nothing else can hit).
 */
import { describe, expect, test } from 'bun:test';
import { type JudgmentSpec, gate } from '../src/gate/gate.ts';
import * as fx from './gate-fixtures.ts';

const OPEN_SPEC: JudgmentSpec = { text: { type: 'string', maxLength: 8000 } };

function refuses(text: string): { reason: string; rule: string | undefined; json: string } {
  const result = gate(OPEN_SPEC, { state: { text }, questions: {} });
  if (result.kind !== 'no-judgment') throw new Error(`expected a refusal, got ${result.kind}`);
  return { reason: result.reason, rule: result.rule, json: JSON.stringify(result) };
}

/** No 8-character run of `secret` appears anywhere in `json` — the "no matched text"
 *  guarantee, checked against every overlapping window rather than the whole string. */
function assertNoFragmentLeaked(json: string, secret: string): void {
  for (let i = 0; i + 8 <= secret.length; i++) {
    expect(json).not.toContain(secret.slice(i, i + 8));
  }
}

describe('gate-secrets: the companion-plan CI-excerpt scenario', () => {
  test('a curl Authorization: Bearer excerpt refuses on entropy, not the dropped curl-auth-header rule', () => {
    const secret = fx.fortyCharUnprefixedToken('ci-excerpt-1');
    const excerpt = fx.ciExcerptWithBearerToken('ci-excerpt-1');
    const hit = refuses(excerpt);
    expect(hit.reason).toBe('high-entropy');
    expect(hit.rule).toBeUndefined();
    assertNoFragmentLeaked(hit.json, secret);
  });
});

describe('gate-secrets: gitleaks prefix rules', () => {
  const cases: ReadonlyArray<[string, string, string]> = [
    ['github-pat', 'ghp_ token', fx.githubPat('p1')],
    ['github-fine-grained-pat', 'github_pat_ token', fx.githubFineGrainedPat('p2')],
    ['anthropic-api-key', 'sk-ant-api03- key', fx.anthropicApiKey('p3')],
    ['cloudflare-origin-ca-key', 'v1.0- Origin CA key', fx.cloudflareOriginCaKey('p4')],
    ['aws-access-token', 'AKIA access key', fx.awsAccessKey('p5')],
    ['private-key', 'PEM private-key block', fx.pemPrivateKeyBlock('p6')],
    ['vault-service-token', 'hvs. vault token', fx.vaultServiceTokenHvs('p7')],
    [
      'vault-service-token',
      's. vault token (case-fold-expanded rule)',
      fx.vaultServiceTokenShort('p8'),
    ],
    ['vault-batch-token', 'hvb. vault batch token', fx.vaultBatchToken('p9')],
    ['slack-bot-token', 'xoxb- Slack bot token', fx.slackBotToken('p10')],
    ['jwt', 'ey…-shaped JWT', fx.jwtLike('p11')],
  ];

  for (const [ruleId, label, secret] of cases) {
    test(`${label} refuses via ${ruleId}, with no fragment leaked`, () => {
      const hit = refuses(secret);
      expect(hit.reason).toBe('gitleaks-rule');
      expect(hit.rule).toBe(ruleId);
      assertNoFragmentLeaked(hit.json, secret);
    });
  }
});

describe('gate-secrets: addresses', () => {
  const refused: ReadonlyArray<[string, string]> = [
    ['10.1.2.3', 'Private-Use /8'],
    ['172.16.5.5', 'Private-Use /12'],
    ['192.168.1.1', 'Private-Use /16'],
    ['100.64.0.5', 'Shared Address Space'],
    ['fd00::1', 'Unique-Local'],
    ['fe80::1', 'Link-Local Unicast'],
  ];
  for (const [address, label] of refused) {
    test(`${label} (${address}) refuses by default`, () => {
      const hit = refuses(`internal host at ${address}`);
      expect(hit.reason).toBe('private-address');
    });
  }

  const allowed = ['8.8.8.8', '2001:4860::1'];
  for (const address of allowed) {
    test(`a globally-reachable address (${address}) is not refused`, () => {
      const result = gate(OPEN_SPEC, { state: { text: `see ${address}` }, questions: {} });
      expect(result.kind).toBe('send');
    });
  }

  test('loopback passes by default and refuses only when refuseLoopback is set', () => {
    const byDefault = gate(OPEN_SPEC, { state: { text: 'curl 127.0.0.1:8080' }, questions: {} });
    expect(byDefault.kind).toBe('send');
    const optedIn = gate(
      OPEN_SPEC,
      { state: { text: 'curl 127.0.0.1:8080' }, questions: {} },
      { refuseLoopback: true },
    );
    expect(optedIn).toMatchObject({ kind: 'no-judgment', reason: 'private-address' });
  });
});

describe('gate-secrets: internalHostnames', () => {
  test('refuses only when the caller passes it as an option — the kit bakes in none', () => {
    const text = 'connecting to db.example.internal now';
    const withoutOption = gate(OPEN_SPEC, { state: { text }, questions: {} });
    expect(withoutOption.kind).toBe('send');

    const withOption = gate(
      OPEN_SPEC,
      { state: { text }, questions: {} },
      { internalHostnames: ['db.example.internal'] },
    );
    expect(withOption).toMatchObject({ kind: 'no-judgment', reason: 'internal-hostname' });
  });
});

describe('gate-secrets: caps, types and object keys', () => {
  test('an over-length string still refuses even with clean content', () => {
    const spec: JudgmentSpec = { text: { type: 'string', maxLength: 10 } };
    const result = gate(spec, {
      state: { text: 'well over the ten character cap' },
      questions: {},
    });
    expect(result).toMatchObject({ kind: 'no-judgment', reason: 'over-length' });
  });

  test('a SECRET-SHAPED object KEY refuses too, not just values', () => {
    const secret = fx.githubPat('key1');
    const result = gate(OPEN_SPEC, { state: {}, questions: { [secret]: {} } });
    if (result.kind !== 'no-judgment') throw new Error('expected a refusal');
    expect(result).toMatchObject({ reason: 'gitleaks-rule', rule: 'github-pat' });
    expect(result.path).toContain('#key');
  });

  test('a keyword-in-the-key, secret-in-the-value split is caught only via the serialized json', () => {
    // Neither field alone matches netlify-access-token: the key "netlify" has no
    // secret-shaped value attached to it, and the value alone has no "netlify"
    // keyword in front of it. JSON.stringify's own `"netlify":"<value>"` shape is
    // exactly the `keyword <punct> value` shape the rule looks for.
    const { key, value } = fx.netlifyKeywordValueSplit('split1');
    const result = gate(OPEN_SPEC, { state: {}, questions: { [key]: value } });
    if (result.kind !== 'no-judgment') throw new Error('expected a refusal');
    expect(result).toMatchObject({ reason: 'gitleaks-rule', rule: 'netlify-access-token' });
    expect(result.path).toBe('$');
  });
});

describe('gate-secrets: evasion attempts still refuse', () => {
  test('a zero-width space inside the secret refuses on the format-character check', () => {
    const secret = fx.githubPat('evade1');
    const withZeroWidth = `${secret.slice(0, 5)}​${secret.slice(5)}`;
    const hit = refuses(withZeroWidth);
    expect(hit.reason).toBe('format-character');
  });

  test('an NFKC-normalisable fullwidth lookalike still refuses', () => {
    // U+FF47 "ｇ" etc. NFKC-fold to plain ASCII, so a fullwidth prefix still matches
    // ghp_ once normalised.
    const fullwidthPrefix = 'ｇｈｐ＿'; // fullwidth g h p _
    const secret = fx.githubPat('evade2').slice(4); // drop the real ASCII "ghp_"
    const hit = refuses(fullwidthPrefix + secret);
    expect(hit.reason).toBe('gitleaks-rule');
    expect(hit.rule).toBe('github-pat');
  });
});
