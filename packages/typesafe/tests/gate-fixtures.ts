/**
 * Secret-SHAPED fixtures for gate.test.ts / gate-secrets.test.ts / gate-tables.test.ts,
 * assembled at runtime from a hashed seed rather than written as a literal contiguous
 * secret-shaped string. The kit's own gitleaks CI job (security.yml, gitleaks-action v3)
 * scans this SOURCE FILE, and a literal `ghp_<36 chars>` here would fail that job on
 * this very PR — every fixture below exists only as bytes computed at test time.
 *
 * Not a `.test.ts`: `bun test` only runs files matching that pattern, so this module
 * contributes no test cases of its own — just the builders the three suites share.
 */

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const HEX = '0123456789abcdef';
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const WORD_DASH = `${ALNUM}_-`;
const DIGITS = '0123456789';

/** Deterministic, high-entropy, non-literal: sha256(`${seed}:${counter}`) bytes mapped
 *  into `alphabet` by index. Same seed always yields the same string, so a fixture-based
 *  test is reproducible without ever spelling the secret shape out in source. */
function deriveRandomish(seed: string, length: number, alphabet: string): string {
  let out = '';
  let counter = 0;
  while (out.length < length) {
    const hex = new Bun.CryptoHasher('sha256').update(`${seed}:${counter}`).digest('hex');
    for (let i = 0; i < hex.length && out.length < length; i += 2) {
      const byte = Number.parseInt(hex.slice(i, i + 2), 16);
      out += alphabet[byte % alphabet.length];
    }
    counter += 1;
  }
  return out;
}

/** A 40-character unprefixed token shape — the companion-plan failure scenario: no
 *  gitleaks prefix rule names this, curl-auth-header is a DROPPED rule (bare mid-pattern
 *  `(?i)`), so only entropy stands between this and a leak. */
export const fortyCharUnprefixedToken = (seed: string): string => deriveRandomish(seed, 40, ALNUM);

/** A 40-hex-character run — the documented over-refusal case: indistinguishable, by
 *  shape alone, from a full git commit SHA. */
export const fortyHexRun = (seed: string): string => deriveRandomish(seed, 40, HEX);

export const githubPat = (seed: string): string => `ghp_${deriveRandomish(seed, 36, ALNUM)}`;

export const githubFineGrainedPat = (seed: string): string =>
  `github_pat_${deriveRandomish(seed, 82, ALNUM)}`;

export const anthropicApiKey = (seed: string): string =>
  `sk-ant-api03-${deriveRandomish(seed, 93, WORD_DASH)}AA`;

export const cloudflareOriginCaKey = (seed: string): string =>
  `v1.0-${deriveRandomish(`${seed}a`, 24, HEX)}-${deriveRandomish(`${seed}b`, 146, HEX)}`;

export const awsAccessKey = (seed: string): string => `AKIA${deriveRandomish(seed, 16, BASE32)}`;

/** A PEM-shaped block: BEGIN/END lines the rule's literal text requires, with >=64
 *  bytes of filler between them (the rule's own `{64,}?`). Not a real key — the body is
 *  derived filler, never parseable as one. The BEGIN/END markers themselves are joined
 *  from fragments, not written as one contiguous literal: gitleaks' own `private-key`
 *  rule matches on the markers alone, entropy or no, so a literal
 *  `-----BEGIN...PRIVATE KEY-----` right here would trip this repo's OWN gitleaks CI
 *  job — the failure mode the unit's own attack list names. */
const PEM_BEGIN = ['-----BEGIN', ' RSA', ' PRIVATE', ' KEY', '-----'].join('');
const PEM_END = ['-----END', ' RSA', ' PRIVATE', ' KEY', '-----'].join('');
export const pemPrivateKeyBlock = (seed: string): string =>
  `${PEM_BEGIN}\n${deriveRandomish(seed, 200, `${ALNUM}+/`)}\n${PEM_END}`;

export const vaultServiceTokenHvs = (seed: string): string =>
  `hvs.${deriveRandomish(seed, 100, WORD_DASH)}`;

/** The short `s.` shape only the gate's own case-fold expansion of gitleaks'
 *  `s\.(?i:[a-z0-9]{24})` catches — proves the translated rule, not just the untouched
 *  `hvs.` one. */
export const vaultServiceTokenShort = (seed: string): string =>
  `s.${deriveRandomish(seed, 24, ALNUM)}`;

export const vaultBatchToken = (seed: string): string =>
  `hvb.${deriveRandomish(seed, 150, WORD_DASH)}`;

export const slackBotToken = (seed: string): string =>
  `xoxb-${deriveRandomish(`${seed}a`, 11, DIGITS)}-${deriveRandomish(`${seed}b`, 11, DIGITS)}${deriveRandomish(`${seed}c`, 24, ALNUM)}`;

export const jwtLike = (seed: string): string =>
  `ey${deriveRandomish(`${seed}a`, 20, ALNUM)}.ey${deriveRandomish(`${seed}b`, 30, ALNUM)}.${deriveRandomish(`${seed}c`, 20, ALNUM)}`;

/** netlify-access-token's shape is `keyword <punct> value` with optional surrounding
 *  quotes — exactly what a JSON `"netlify":"<secret>"` pair serializes to. The KEYWORD
 *  lives in one field (an object KEY) and the SECRET in another (that key's own value):
 *  scanning the key alone never sees the value, scanning the value alone never sees the
 *  keyword, and only the full-serialized-json scan puts them back together. */
export const netlifyKeywordValueSplit = (seed: string): { key: string; value: string } => ({
  key: 'netlify',
  value: deriveRandomish(seed, 43, `${'abcdefghijklmnopqrstuvwxyz0123456789'}=_-`),
});

/** The companion-plan CI-excerpt fixture: a curl command's Authorization header next to
 *  its own failing response line — the shape a build log or a PR body legitimately
 *  quotes. curl-auth-header itself is a DROPPED rule (bare mid-pattern `(?i)`), so this
 *  is refused by entropy alone if it is refused at all. */
export const ciExcerptWithBearerToken = (seed: string): string =>
  `+ curl -sS -H "Authorization: Bearer ${fortyCharUnprefixedToken(seed)}" https://api.example.invalid/v1/widgets\ncurl: (22) The requested URL returned error: 403`;

/** sidekiq-sensitive-url and slack-webhook-url both key off a literal HOSTNAME, not a
 *  high-entropy secret — gitleaks' own keyword prefilter for each is the exact substring
 *  "gems.contribsys.com" / "enterprise.contribsys.com" / "hooks.slack.com". Once any of
 *  those appears ANYWHERE in a scanned file, gitleaks applies that rule's regex to the
 *  WHOLE file — so even a deliberately dot-swapped negative fixture on another line would
 *  also be flagged, by gitleaks' real (upstream, unescaped) rule, the moment the correct
 *  host text exists anywhere nearby. Every label below is joined at runtime from
 *  fragments so the exact host text never appears contiguously in this file's own source
 *  (see this file's header) — `dot` is a parameter, not always ".", so the same builder
 *  produces both the true-positive host and the "one dot swapped for a non-dot character"
 *  negative fixture gate-tables.test.ts's hostname-escaping tests need. */
function hostFromLabels(labels: readonly string[], dot: string): string {
  return labels.join(dot);
}

export const sidekiqSensitiveUrl = (
  seed: string,
  org: 'gems' | 'enterprise' = 'gems',
  dot = '.',
): string => {
  const cred = `${deriveRandomish(`${seed}a`, 8, HEX)}:${deriveRandomish(`${seed}b`, 8, HEX)}`;
  return `https://${cred}@${hostFromLabels([org, 'contribsys', 'com'], dot)}/jobs`;
};

export const slackWebhookUrl = (seed: string, dot = '.'): string =>
  `https://${hostFromLabels(['hooks', 'slack', 'com'], dot)}/services/${deriveRandomish(seed, 44, ALNUM)}`;
