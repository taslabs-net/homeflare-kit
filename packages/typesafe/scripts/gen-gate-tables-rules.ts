/**
 * Translates gitleaks' 221 regex rules into JS-safe source strings, or drops each one
 * it cannot carry faithfully — with the reason recorded, never silently.
 *
 * ⛔ MEASURED, NOT GUESSED, 2026-09-23 under Bun 1.4.0: stripping a single leading
 *   `(?i)` into flag `i` and calling `new RegExp` on the 221 rules that carry a regex
 *   gives exactly 179 clean, 23 that fail to compile at all (mostly bare mid-pattern
 *   `(?i)`, but also `(?P<name>…)` named groups — jwt-base64 — and one unsupported
 *   modifier — authress-service-client-access-key), 15 that compile but keep a scoped
 *   modifier group `(?flags:…)` our floor (Node ≥22) cannot run, 3 that use `\z`
 *   (curl-auth-user, openshift-user-token, sentry-org-token), and 1 POSIX class
 *   (airtable-personnal-access-token). See scripts/gen-gate-tables.ts's header for the
 *   command that reproduces this count from the cached config.
 *
 * ★ Every estate-relevant rule this repo's threat model cares about — github-pat,
 *   github-fine-grained-pat, github-app-token, github-oauth, cloudflare-api-key,
 *   cloudflare-global-api-key, cloudflare-origin-ca-key, vault-batch-token,
 *   anthropic-api-key, openai-api-key, aws-access-token, private-key, jwt,
 *   slack-bot-token — is clean and therefore emitted.
 */

export interface GitleaksRaw {
  readonly id: string;
  readonly description: string;
  readonly regex?: string;
  readonly entropy?: number;
  readonly secretGroup?: number;
}

export interface EmittedRule {
  readonly id: string;
  readonly description: string;
  readonly source: string;
  readonly flags: string;
  readonly entropy?: number;
  readonly secretGroup?: number;
}

export interface DroppedRule {
  readonly id: string;
  readonly reason: string;
}

export interface ClassifyResult {
  readonly emitted: readonly EmittedRule[];
  readonly dropped: readonly DroppedRule[];
  readonly regexRuleCount: number;
}

/**
 * DELIBERATE DEVIATION FROM UPSTREAM — CodeQL "Incomplete regular expression for
 * hostnames" on PR 162 (gitleaks-rules-emitted.ts lines 172/181, since regenerated).
 * gitleaks writes a hostname literal like `gems.contribsys.com` with a bare `.`, which
 * in a regex also matches any other character, e.g. `gemsXcontribsysXcom`. That is not
 * a secret-detector vulnerability in the way an escape bug usually is: as a REGEX, `\.`
 * is strictly narrower than `.`, so this only removes false accepts of a one-character-
 * off lookalike host, never a real one. Fixed anyway because CodeQL is right that it is
 * not the regex gitleaks meant.
 *
 * ⚠️ One measured, narrow caveat (adversarial review on this PR): gate/scan.ts's input
 *   normalization is NFKC only, which does NOT fold IDNA-equivalent full-stop lookalikes
 *   (U+3002 IDEOGRAPHIC FULL STOP, U+FF61 HALFWIDTH IDEOGRAPHIC FULL STOP) to ASCII `.`.
 *   A real, IDNA-resolvable URL spelled with one of those in place of the dot was
 *   incidentally caught by the OLD loose `.` (which matches any character) and is not
 *   caught by `\.` for these two rules. This is not new: microsoft-teams-webhook already
 *   escapes its dots upstream and already has this gap on main. Not fixed here — folding
 *   IDNA lookalikes belongs in scan.ts's normalization, a broader change than this
 *   generator fix — but recorded so it isn't mistaken for a non-issue.
 *
 * Each entry names the exact translated-source substring gitleaks emits (`before`) and
 * its hostname-safe replacement (`after`) — applied only to the one rule id it names, and
 * only if `before` is found verbatim (see applyHostnameDotEscapes). This is an explicit
 * list, not a generic "escape every bare dot" rewrite: a generic rewrite would also hit
 * the `.` gitleaks intentionally uses as a wildcard inside `[\w.-]` prefix classes on
 * ~100 other rules (see gate-tables.test.ts), which is a wholly different construct
 * (already inside a character class, where `.` is already literal) that must not change.
 */
const HOSTNAME_DOT_ESCAPES: readonly { id: string; before: string; after: string }[] = [
  {
    id: 'sidekiq-sensitive-url',
    before: 'gems.contribsys.com|enterprise.contribsys.com',
    after: 'gems\\.contribsys\\.com|enterprise\\.contribsys\\.com',
  },
  {
    id: 'slack-webhook-url',
    before: 'hooks.slack.com',
    after: 'hooks\\.slack\\.com',
  },
];

function applyHostnameDotEscapes(id: string, body: string): string {
  let out = body;
  for (const fix of HOSTNAME_DOT_ESCAPES) {
    if (fix.id !== id) continue;
    const occurrences = out.split(fix.before).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `gen-gate-tables: hostname-dot-escape for ${id} expected exactly one occurrence of ` +
          `${JSON.stringify(fix.before)} in its translated source, found ${occurrences} — upstream ` +
          'gitleaks changed this rule; update or remove this deviation entry in gen-gate-tables-rules.ts.',
      );
    }
    out = out.split(fix.before).join(fix.after);
  }
  return out;
}

function stripLeadingI(regex: string): { body: string; flags: string; hadLeadingI: boolean } {
  if (regex.startsWith('(?i)')) return { body: regex.slice(4), flags: 'i', hadLeadingI: true };
  return { body: regex, flags: '', hadLeadingI: false };
}

/** `\z` (true end of text, no trailing-newline exception) is exactly `$` in JS when the
 *  pattern carries no `m` flag — none of the three rules that use it do. */
function translateZAnchor(body: string): string {
  return body.replace(/\\z/g, '$');
}

/** A modifier group's body qualifies for case-fold expansion only when it turns
 *  case-insensitivity ON (`i`, not `-i`) over exactly one bracket-class atom — nothing
 *  with alternation, nested groups or a negative flag. That is a narrow, mechanical
 *  rule, not a per-id allowlist: it happens to fire on vault-service-token
 *  (`s\.(?i:[a-z0-9]{24})`) and the two huggingface token rules, and on nothing else in
 *  this config today.
 */
const SIMPLE_CLASS_BODY = /^\[([^\]]*)\](\{\d+(?:,\d*)?\}|[+*?])?$/;

function foldClassBody(inner: string): string {
  const tokens: string[] = [];
  for (let i = 0; i < inner.length;) {
    if (inner[i] === '\\' && i + 1 < inner.length) {
      tokens.push(inner.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (inner[i + 1] === '-' && inner[i + 2] !== undefined && inner[i + 2] !== '\\') {
      tokens.push(inner.slice(i, i + 3));
      i += 3;
      continue;
    }
    tokens.push(inner[i] ?? '');
    i += 1;
  }
  const folded: string[] = [];
  for (const t of tokens) {
    folded.push(t);
    const lowerRange = /^([a-z])-([a-z])$/.exec(t);
    const upperRange = /^([A-Z])-([A-Z])$/.exec(t);
    if (lowerRange)
      folded.push(`${(lowerRange[1] ?? '').toUpperCase()}-${(lowerRange[2] ?? '').toUpperCase()}`);
    else if (upperRange)
      folded.push(`${(upperRange[1] ?? '').toLowerCase()}-${(upperRange[2] ?? '').toLowerCase()}`);
    else if (/^[a-z]$/.test(t)) folded.push(t.toUpperCase());
    else if (/^[A-Z]$/.test(t)) folded.push(t.toLowerCase());
  }
  return folded.join('');
}

/** One modifier group `(?flags:body)`, expanded in place if it qualifies. Returns
 *  `undefined` when this specific group does not qualify — the CALLER drops the whole
 *  rule, because a partial rewrite would silently under-match. */
function expandModifierGroup(body: string): string | undefined {
  const matches = [...body.matchAll(/\(\?([a-zA-Z-]+):((?:[^()]|\([^)]*\))*)\)/g)];
  if (matches.length === 0) return undefined;
  let out = body;
  for (const m of matches) {
    const flags = m[1] ?? '';
    const inner = m[2] ?? '';
    if (flags !== 'i') return undefined;
    const classMatch = SIMPLE_CLASS_BODY.exec(inner);
    if (!classMatch) return undefined;
    const foldedInner = foldClassBody(classMatch[1] ?? '');
    const replacement = `[${foldedInner}]${classMatch[2] ?? ''}`;
    out = out.replace(m[0], replacement);
  }
  return out;
}

export function classifyRules(rules: readonly GitleaksRaw[]): ClassifyResult {
  const emitted: EmittedRule[] = [];
  const dropped: DroppedRule[] = [];
  let regexRuleCount = 0;

  for (const r of rules) {
    if (typeof r.regex !== 'string') continue;
    regexRuleCount += 1;
    const { body, flags } = stripLeadingI(r.regex);
    // Field order matters: this must match renderEmitted's own field order exactly, or
    // a digest computed here (pre-render) disagrees with one computed from the
    // re-imported, rendered file — gate-tables.test.ts checks exactly that agreement.
    // exactOptionalPropertyTypes: only include entropy/secretGroup when gitleaks set them.
    const emit = (source: string): EmittedRule => ({
      id: r.id,
      description: r.description,
      source: applyHostnameDotEscapes(r.id, source),
      flags,
      ...(r.entropy !== undefined ? { entropy: r.entropy } : {}),
      ...(r.secretGroup !== undefined ? { secretGroup: r.secretGroup } : {}),
    });

    if (body.includes('[[:')) {
      dropped.push({ id: r.id, reason: 'POSIX bracket class ([[:...:]]) has no JS equivalent' });
      continue;
    }
    let compiles = true;
    try {
      new RegExp(body, flags);
    } catch (e) {
      compiles = false;
      dropped.push({
        id: r.id,
        reason: `does not compile as a JS RegExp: ${(e as Error).message}`,
      });
    }
    if (!compiles) continue;

    if (/\\z/.test(body)) {
      emitted.push(emit(translateZAnchor(body)));
      continue;
    }
    if (/\(\?[a-zA-Z-]+:/.test(body)) {
      const expanded = expandModifierGroup(body);
      if (expanded === undefined) {
        dropped.push({
          id: r.id,
          reason:
            'scoped modifier group (?flags:…) is not a Node ≥22-safe construct, and its body is not a simple case-foldable class',
        });
        continue;
      }
      emitted.push(emit(expanded));
      continue;
    }
    emitted.push(emit(body));
  }

  return { emitted, dropped, regexRuleCount };
}
