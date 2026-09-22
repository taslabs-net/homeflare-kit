/**
 * Values a declaration may SEND and must never STORE — a webhook secret, a header carrying a
 * credential, an smtp password — and the one form in which a plan may still remember them.
 *
 * ⛔ A SECRET PROP IS A SECRET IN THE STATE STORE, WHATEVER TYPE IT HAS. Alchemy persists props as
 *   well as attributes — `delete` is handed `olds`, which can only have come from the store — and
 *   it does not encrypt either: `StateEncoding.ts` TAGS a `Redacted` value and writes the inner
 *   value beside the tag. So `Redacted` hides a secret from a log line and from nothing else.
 *   notification-target.ts (PVE) answered that by making no secret declarable at all, and paid
 *   for it: an authenticated smtp target or a signed webhook could not be created from code.
 * ★ SO THE PROP HOLDS A NAME, NOT A VALUE. `{ fromEnv: 'PBS_HOOK_TOKEN' }` names the variable the
 *   DEPLOYING process reads at call time — the shape forgejo/org-actions-secrets.ts already uses.
 *   The name is what lands in state; the value exists only in that process's memory and on the
 *   wire to the server.
 *
 * ⚠️ A PLAN STILL NEEDS TO KNOW WHETHER A VALUE CHANGED, AND IT CANNOT ASK THE SERVER. PBS returns a
 *   webhook secret's NAME and never its value, and never returns an smtp password at all. So what
 *   was last written is remembered as a SEAL: a salted scrypt digest, which lets the next plan
 *   check "is the value in my environment the one I wrote" without the store holding anything a
 *   reader could send to PBS.
 *   ⚠️ A DIGEST OF A GUESSABLE SECRET IS STILL GUESSABLE. The salt defeats precomputed tables and
 *     scrypt makes each guess cost memory and time; neither makes a dictionary word safe. The
 *     remedy is a secret worth the name — a random token — not a faster hash.
 */
import { Buffer } from 'node:buffer';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** A write-only value, by the NAME of the environment variable holding it. Never the value. */
export interface FromEnv {
  readonly fromEnv: string;
}

/** Where a value is looked up. Defaults to `process.env`, read at call time, never at load. */
export type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Each `name → FromEnv` resolved, or the variable names that could not be.
 *
 * ⚠️ AN EMPTY VARIABLE IS A MISSING ONE. A secret renderer that failed writes `NAME=` rather than
 *   omitting the line, and sending `''` would store an empty secret on the server — a webhook that
 *   authenticates with nothing, reported as a successful deploy.
 * ⚠️ THE VALUE IS NOT TRIMMED. A token with a trailing newline is a broken header either way, and
 *   trimming here would make the seal disagree with a value written by any other tool.
 */
export const resolveAll = (
  refs: Readonly<Record<string, FromEnv>>,
  env: Environment = process.env,
): { readonly values: Readonly<Record<string, string>>; readonly missing: readonly string[] } => {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const [key, ref] of Object.entries(refs)) {
    const value = env[ref.fromEnv];
    if (value === undefined || value === '') missing.push(ref.fromEnv);
    else values[key] = value;
  }
  return { missing: [...new Set(missing)].sort(), values };
};

/**
 * ★ PARAMETERS ARE NODE'S OWN SCRYPT DEFAULTS (N 2^14, r 8, p 1) — 16 MiB and tens of
 *   milliseconds per digest. Plan runs it a handful of times per resource, which is noise, and a
 *   guesser runs it once per guess, which is the point.
 */
const COST = { N: 16_384, maxmem: 64 * 1024 * 1024, p: 1, r: 8 } as const;
const PREFIX = 'scrypt';

/** Key order must not change a digest, so entries are sorted and serialised as JSON pairs. */
const canonical = (values: Readonly<Record<string, string>>): string =>
  JSON.stringify(
    Object.keys(values)
      .sort()
      .map((key) => [key, values[key]]),
  );

const digest = (salt: Buffer, values: Readonly<Record<string, string>>): Buffer =>
  scryptSync(canonical(values), salt, 32, COST);

/**
 * `scrypt:<salt>:<digest>`, or `''` when there is nothing to seal.
 *
 * ★ A RANDOM SALT BY DEFAULT, FOR WHAT THIS PROVIDER WROTE. Pass a fixed one only for a value the
 *   server returns anyway (a header), where a fresh salt per read would churn the state row on
 *   every plan without protecting anything the server does not already show its auditors.
 */
export const seal = (values: Readonly<Record<string, string>>, salt?: string): string => {
  if (Object.keys(values).length === 0) return '';
  const bytes = salt === undefined ? randomBytes(16) : Buffer.from(salt, 'utf8');
  return `${PREFIX}:${bytes.toString('base64url')}:${digest(bytes, values).toString('base64url')}`;
};

/**
 * Whether `values` are the ones `sealed` was made from.
 *
 * ⚠️ A MALFORMED OR EMPTY SEAL ANSWERS FALSE, never throws: callers decide what "no evidence"
 *   means, and every caller here treats it as "cannot tell" rather than as drift.
 */
export const sealMatches = (sealed: string, values: Readonly<Record<string, string>>): boolean => {
  if (sealed === '') return Object.keys(values).length === 0;
  const [prefix, salt, stored, extra] = sealed.split(':');
  if (prefix !== PREFIX || salt === undefined || stored === undefined || extra !== undefined) {
    return false;
  }
  const expected = Buffer.from(stored, 'base64url');
  const actual = digest(Buffer.from(salt, 'base64url'), values);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
