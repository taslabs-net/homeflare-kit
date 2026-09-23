/**
 * Walks a payload for secret-shaped content: every string VALUE, every object KEY, and
 * the full serialized json (so a secret split across two fields — one holding a prefix,
 * another a suffix — is still caught, since it is still adjacent once the payload is
 * serialized whole). Compiles the gitleaks-derived rules lazily, once, on first use —
 * and if even ONE rule fails to compile at runtime, the WHOLE gate fails closed for
 * every subsequent call, not just the one rule.
 *
 * ⛔ NEVER RETURNS MATCHED TEXT. A `ScanHit` carries a field path and a rule id at
 *   most — never the string that tripped it. A refusal that echoed the secret it caught
 *   would be worse than not scanning at all.
 */
import { type AddressOptions, findRefusedAddress, matchesInternalHostname } from './addresses.ts';
import { type EntropyOptions, findHighEntropyRun, gitleaksEntropy } from './entropy.ts';
import { GITLEAKS_RULES_EMITTED, type GateRule } from './generated/gitleaks-rules.ts';

export interface ScanOptions extends EntropyOptions, AddressOptions {
  readonly internalHostnames?: readonly (RegExp | string)[];
}

export type ScanReason =
  | 'rule-unavailable'
  | 'format-character'
  | 'gitleaks-rule'
  | 'high-entropy'
  | 'private-address'
  | 'internal-hostname';

export interface ScanHit {
  readonly reason: ScanReason;
  readonly path: string;
  readonly rule?: string;
}

interface CompiledRule {
  readonly id: string;
  readonly regex: RegExp;
  readonly entropy?: number;
  readonly secretGroup?: number;
}

/** Compiles a rule table with `new RegExp` inside try/catch — ONE bad rule marks the
 *  WHOLE table unavailable, not just that rule, so a caller can never silently get
 *  weaker coverage than they think they have. Pure and exported so gate-tables.test.ts
 *  and gate-secrets.test.ts can prove the fail-closed path directly, with a deliberately
 *  broken rule, instead of only trusting that the real table happens to compile. */
export function compileRuleTable(
  rules: readonly GateRule[],
): readonly CompiledRule[] | 'unavailable' {
  const out: CompiledRule[] = [];
  for (const r of rules) {
    try {
      out.push({
        id: r.id,
        regex: new RegExp(r.source, r.flags),
        ...(r.entropy !== undefined ? { entropy: r.entropy } : {}),
        ...(r.secretGroup !== undefined ? { secretGroup: r.secretGroup } : {}),
      });
    } catch {
      return 'unavailable';
    }
  }
  return out;
}

let compiledCache: readonly CompiledRule[] | 'unavailable' | undefined;

/** {@link compileRuleTable} over the real generated table, memoized for the life of the
 *  process. */
function compiledRules(): readonly CompiledRule[] | 'unavailable' {
  if (compiledCache === undefined) compiledCache = compileRuleTable(GITLEAKS_RULES_EMITTED);
  return compiledCache;
}

/** Unicode Format category (Cf): zero-width space/joiner/non-joiner, bidi overrides,
 *  soft hyphen, and similar characters with no visible glyph — a common obfuscation for
 *  splitting a secret so a literal regex misses it. Checked on the NFKC-normalised
 *  string, which also collapses most confusable-lookalike evasions before any detector
 *  runs. */
const FORMAT_CHARACTER = /\p{Cf}/u;

/** Mirrors detect/detect.go: use `groups[secretGroup]` when set and in range, else the
 *  first non-empty capture group, else the whole match. */
function secretText(match: RegExpExecArray, secretGroup: number | undefined): string {
  if (match.length < 2) return match[0];
  if (secretGroup !== undefined && secretGroup > 0 && secretGroup < match.length) {
    return match[secretGroup] ?? match[0];
  }
  for (let i = 1; i < match.length; i++) {
    const g = match[i];
    if (g !== undefined && g.length > 0) return g;
  }
  return match[0];
}

function scanString(
  path: string,
  raw: string,
  rules: readonly CompiledRule[] | 'unavailable',
  options: ScanOptions,
): ScanHit | undefined {
  const s = raw.normalize('NFKC');
  if (FORMAT_CHARACTER.test(s)) return { reason: 'format-character', path };

  if (rules === 'unavailable') return { reason: 'rule-unavailable', path };
  for (const rule of rules) {
    const match = rule.regex.exec(s);
    if (!match) continue;
    if (rule.entropy !== undefined) {
      const secret = secretText(match, rule.secretGroup);
      if (gitleaksEntropy(secret) <= rule.entropy) continue; // gitleaks: too low, skip
    }
    return { reason: 'gitleaks-rule', path, rule: rule.id };
  }

  if (findHighEntropyRun(s, options)) return { reason: 'high-entropy', path };
  if (findRefusedAddress(s, options)) return { reason: 'private-address', path };
  if (matchesInternalHostname(s, options.internalHostnames))
    return { reason: 'internal-hostname', path };
  return undefined;
}

function scanValue(
  path: string,
  value: unknown,
  rules: readonly CompiledRule[] | 'unavailable',
  options: ScanOptions,
): ScanHit | undefined {
  if (typeof value === 'string') return scanString(path, value, rules, options);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = scanValue(`${path}[${i}]`, value[i], rules, options);
      if (hit) return hit;
    }
    return undefined;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const keyHit = scanString(`${path}.${key}#key`, key, rules, options);
      if (keyHit) return keyHit;
      const hit = scanValue(`${path}.${key}`, v, rules, options);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Scans `state` and `questions`, then the whole `{state, questions}` payload
 *  serialized as one string — catching a secret split across two adjacent fields.
 *  Short-circuits on the first hit: a gate refuses the whole call on any one finding,
 *  so nothing is gained by collecting more. */
export function scanPayload(
  state: unknown,
  questions: unknown,
  options: ScanOptions,
): ScanHit | undefined {
  const rules = compiledRules();
  if (rules === 'unavailable') return { reason: 'rule-unavailable', path: '$' };

  return (
    scanValue('$.state', state, rules, options) ??
    scanValue('$.questions', questions, rules, options) ??
    scanString('$', JSON.stringify({ state, questions }), rules, options)
  );
}
