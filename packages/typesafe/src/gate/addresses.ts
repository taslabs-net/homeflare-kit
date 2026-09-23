/**
 * IPv4 / IPv6 extraction and CIDR membership, driven by the IANA special-purpose
 * registries generated into ./generated/special-ranges.ts — never a hand-typed list of
 * "private" ranges. Plus a plain hostname/domain-suffix check for the caller-supplied
 * `internalHostnames` option (the kit bakes in none — an estate value is a caller
 * option, never a constant here; see AGENTS.md "estate values are props").
 */
import { SPECIAL_RANGES, type SpecialRange } from './generated/special-ranges.ts';

/** IPv4 candidates: word-bounded so a trailing `:8080` port never merges into the
 *  address — `\b` stops right after the last digit, before the colon. */
const IPV4_CANDIDATE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

/** IPv6 candidates: hex/colon runs only (no dots — an embedded IPv4 tail is out of
 *  scope, per ipv6ToBigint's own comment), so a preceding dotted-quad is never fused
 *  into the same run. No `\b` at the leading edge: a `\b` needs a word character on one
 *  side, which a leading `::` (both sides non-word) would never satisfy — ipv6ToBigint's
 *  own 8-group/compression check is what rejects a false positive here, not the regex. */
const IPV6_CANDIDATE = /[0-9A-Fa-f:]{2,}/g;

function ipv4ToUint(ip: string): number | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return undefined;
    const n = Number(p);
    if (n > 255 || (p.length > 1 && p.startsWith('0'))) return undefined;
    value = value * 256 + n;
  }
  return value >>> 0;
}

/** Full-form or `::`-compressed IPv6, hextets only — no embedded IPv4 tail and no zone
 *  id. That covers every row the IANA IPv6 registry lists and every address the gate's
 *  own tests exercise; a fancier literal is simply not recognised as an address (never
 *  a false "safe"), which is the fail-closed direction for a detector like this. */
function ipv6ToBigint(ip: string): bigint | undefined {
  if (ip.indexOf(':') === -1) return undefined;
  const compressedParts = ip.split('::');
  if (compressedParts.length > 2) return undefined;
  const splitHextets = (s: string): string[] => (s.length === 0 ? [] : s.split(':'));
  let head: string[];
  let tail: string[];
  if (compressedParts.length === 2) {
    head = splitHextets(compressedParts[0] ?? '');
    tail = splitHextets(compressedParts[1] ?? '');
  } else {
    head = splitHextets(compressedParts[0] ?? '');
    tail = [];
  }
  const missing = 8 - head.length - tail.length;
  if (compressedParts.length === 1 && missing !== 0) return undefined;
  if (compressedParts.length === 2 && missing < 0) return undefined;
  const groups = [...head, ...Array(compressedParts.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8) return undefined;
  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9A-Fa-f]{1,4}$/.test(g)) return undefined;
    value = (value << 16n) | BigInt(Number.parseInt(g, 16));
  }
  return value;
}

function parseCidr(range: SpecialRange): { base: bigint; prefix: number } | undefined {
  const [addr, prefixStr] = range.cidr.split('/');
  if (addr === undefined || prefixStr === undefined) return undefined;
  const prefix = Number(prefixStr);
  const base = range.family === 4 ? ipv4ToUint(addr) : ipv6ToBigint(addr);
  if (base === undefined) return undefined;
  return { base: BigInt(base), prefix };
}

function inCidr(
  value: bigint,
  width: 32 | 64 | 128,
  cidr: { base: bigint; prefix: number },
): boolean {
  if (cidr.prefix === 0) return true;
  const bits = width === 32 ? 32n : 128n;
  const mask =
    cidr.prefix >= (width === 32 ? 32 : 128)
      ? (1n << bits) - 1n
      : ((1n << BigInt(cidr.prefix)) - 1n) << (bits - BigInt(cidr.prefix));
  return (value & mask) === (cidr.base & mask);
}

export interface AddressOptions {
  readonly refuseLoopback?: boolean;
  readonly refuseDocumentationRanges?: boolean;
}

export interface AddressHit {
  readonly address: string;
  readonly rangeName: string;
  readonly cidr: string;
}

function shouldRefuse(range: SpecialRange, options: AddressOptions): boolean {
  if (range.refuseByDefault) return true;
  if (range.category === 'loopback') return options.refuseLoopback === true;
  if (range.category === 'documentation') return options.refuseDocumentationRanges === true;
  return false;
}

/** First address in `text` that falls in a range the options say to refuse, or
 *  `undefined`. Never returns the address text beyond what the caller already gave it —
 *  callers only ever surface `rangeName`/`cidr` in a refusal, never `address`. */
export function findRefusedAddress(text: string, options: AddressOptions): AddressHit | undefined {
  const candidates: Array<{ run: string; family: 4 | 6; value: bigint }> = [];
  for (const m of text.matchAll(IPV4_CANDIDATE)) {
    const v4 = ipv4ToUint(m[0]);
    if (v4 !== undefined) candidates.push({ run: m[0], family: 4, value: BigInt(v4) });
  }
  for (const m of text.matchAll(IPV6_CANDIDATE)) {
    const v6 = ipv6ToBigint(m[0]);
    if (v6 !== undefined) candidates.push({ run: m[0], family: 6, value: v6 });
  }

  for (const { run, family, value } of candidates) {
    for (const range of SPECIAL_RANGES) {
      if (range.family !== family) continue;
      if (!shouldRefuse(range, options)) continue;
      const cidr = parseCidr(range);
      if (cidr === undefined) continue;
      if (inCidr(value, family === 4 ? 32 : 128, cidr)) {
        return { address: run, rangeName: range.name, cidr: range.cidr };
      }
    }
  }
  return undefined;
}

function hostnameMatches(text: string, pattern: RegExp | string): boolean {
  if (typeof pattern === 'string') {
    // Domain-SUFFIX match, searched anywhere in the field (a URL, a log line, …), not
    // just an exact whole-field match — `db.example.internal` must refuse whether it is
    // the whole value or one hostname inside a longer string.
    const needle = pattern.toLowerCase();
    const lower = text.toLowerCase();
    let from = 0;
    for (;;) {
      const at = lower.indexOf(needle, from);
      if (at === -1) return false;
      const before = at === 0 ? '' : lower[at - 1];
      const after = lower[at + needle.length];
      const boundaryBefore = before === undefined || before === '.' || /[^a-z0-9.-]/.test(before);
      const boundaryAfter = after === undefined || /[^a-z0-9.-]/.test(after);
      if (boundaryBefore && boundaryAfter) return true;
      from = at + 1;
    }
  }
  return pattern.test(text);
}

/** True when `text` contains one of the caller's `internalHostnames`. No defaults: the
 *  kit ships none, per AGENTS.md. */
export function matchesInternalHostname(
  text: string,
  patterns: readonly (RegExp | string)[] | undefined,
): boolean {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((p) => hostnameMatches(text, p));
}
