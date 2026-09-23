/**
 * Shannon entropy over base64 and hex runs, reimplementing detect-secrets v1.5.0's
 * `Base64HighEntropyString` / `HexHighEntropyString`
 * (detect_secrets/plugins/high_entropy_strings.py, blob 5a352cb195f7e6b9e494edc40bbbf
 *  53a3a4b5dfe, Apache-2.0, measured 2026-09-23) — same charset, same limit, same
 * all-digits penalty on the hex side. detect-secrets requires the candidate run to sit
 * between matching quotes in source text; this gate has no such delimiter (it scans
 * field VALUES, not source lines), so it extracts maximal same-charset runs instead and
 * applies a minimum run length before scoring one.
 *
 * ⚠️ THAT MINIMUM IS A HOUSE POLICY CONSTANT, REASONED NOT MEASURED. Chosen so a
 *   Cloudflare Global API Key (37 hex chars — cloudflare-global-api-key's own shape)
 *   and a 40-character unprefixed runtime-minted token both cross it with margin.
 *   Lower it and short, low-value strings start tripping the entropy check; raise it
 *   and a real secret can hide by never exceeding it. Exposed as options so a caller
 *   can retune without a kit change.
 */

const BASE64_CHARSET = /[A-Za-z0-9+/\-_=]/;
const HEX_CHARSET = /[0-9a-fA-F]/;

export const DEFAULT_MIN_HEX_RUN_LENGTH = 32;
export const DEFAULT_MIN_BASE64_RUN_LENGTH = 20;
const BASE64_ENTROPY_LIMIT = 4.5;
const HEX_ENTROPY_LIMIT = 3.0;

function extractRuns(text: string, charset: RegExp): string[] {
  const runs: string[] = [];
  let current = '';
  for (const ch of text) {
    if (charset.test(ch)) {
      current += ch;
    } else {
      if (current.length > 0) runs.push(current);
      current = '';
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

function shannonEntropy(data: string, charset: readonly string[]): number {
  if (data.length === 0) return 0;
  let entropy = 0;
  for (const x of charset) {
    let count = 0;
    for (const ch of data) if (ch === x) count += 1;
    if (count === 0) continue;
    const p = count / data.length;
    entropy += -p * Math.log2(p);
  }
  return entropy;
}

const BASE64_CHARS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/\\-_='];
const HEX_CHARS = [...'0123456789abcdefABCDEF'];

function base64Entropy(run: string): number {
  return shannonEntropy(run, BASE64_CHARS);
}

/** detect-secrets' own comment: an all-digits run scores unrealistically high on a
 *  hex-only charset (max possible ≈3.32, "0123456789"), so a full numeric string —
 *  most commonly a git SHA or a timestamp — gets its entropy pulled down before the
 *  comparison. The `1.2 / log2(length)` formula and the length-1 exemption are copied
 *  verbatim from detect-secrets, not re-derived. */
function hexEntropy(run: string): number {
  const entropy = shannonEntropy(run, HEX_CHARS);
  if (run.length === 1) return entropy;
  if (!/^\d+$/.test(run)) return entropy;
  return entropy - 1.2 / Math.log2(run.length);
}

/** gitleaks' OWN shannon entropy (detect/utils.go `shannonEntropy`, v8.30.1, measured
 *  2026-09-23) — over whatever characters actually appear in `data`, not a fixed
 *  charset. Used only to apply a gitleaks-derived rule's own `entropy` threshold to its
 *  matched secret group, per detect/detect.go's `entropy <= r.Entropy` → skip. Kept
 *  here, next to the other entropy math, rather than duplicated in scan.ts. */
export function gitleaksEntropy(data: string): number {
  if (data.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of data) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  const invLength = 1 / data.length;
  for (const count of counts.values()) {
    const freq = count * invLength;
    entropy -= freq * Math.log2(freq);
  }
  return entropy;
}

export interface EntropyOptions {
  readonly minHexRunLength?: number;
  readonly minBase64RunLength?: number;
}

export interface EntropyHit {
  readonly run: string;
  readonly kind: 'base64' | 'hex';
  readonly entropy: number;
}

/** First high-entropy run in `text`, or `undefined`. A hex run is also a base64 run
 *  (the charsets overlap); checking base64 first means a long hex secret is reported
 *  once, as the wider match, rather than twice under two different reasons. */
export function findHighEntropyRun(text: string, options: EntropyOptions): EntropyHit | undefined {
  const minBase64 = options.minBase64RunLength ?? DEFAULT_MIN_BASE64_RUN_LENGTH;
  const minHex = options.minHexRunLength ?? DEFAULT_MIN_HEX_RUN_LENGTH;

  for (const run of extractRuns(text, BASE64_CHARSET)) {
    if (run.length < minBase64) continue;
    const entropy = base64Entropy(run);
    if (entropy > BASE64_ENTROPY_LIMIT) return { run, kind: 'base64', entropy };
  }
  for (const run of extractRuns(text, HEX_CHARSET)) {
    if (run.length < minHex) continue;
    const entropy = hexEntropy(run);
    if (entropy > HEX_ENTROPY_LIMIT) return { run, kind: 'hex', entropy };
  }
  return undefined;
}
