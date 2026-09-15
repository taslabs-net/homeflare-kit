/**
 * Environment parsing — the one thing every HomeFlare app does before anything else.
 *
 * ★ WHY THIS EXISTS RATHER THAN zod. A Worker reads its config from a plain object
 *   (`env`), not from `process.env`, and it does so on every request. Pulling a schema
 *   library in for that costs bundle size on a hot path to validate perhaps six keys.
 *   This is deliberately small and dependency-free; when a shape genuinely needs
 *   unions, refinement or codecs, reach for zod in the consuming app instead of
 *   growing this.
 *
 * ⚠️ THIS VALIDATES SHAPE, NOT SECRECY. A value arriving here has already been handed
 *   over by the platform — a Worker binding, an OpenBao-minted lease. Nothing in this
 *   file should ever log a value, and callers should not either: a thrown error names
 *   the KEY that was wrong and never what it contained.
 */

/** How one environment key is read, and what it becomes. */
export type EnvSpec =
  | { readonly type: 'string'; readonly optional?: boolean; readonly default?: string }
  | { readonly type: 'number'; readonly optional?: boolean; readonly default?: number }
  | { readonly type: 'boolean'; readonly optional?: boolean; readonly default?: boolean };

/** A description of every key an app needs, keyed by the name it appears under. */
export type EnvSchema = Readonly<Record<string, EnvSpec>>;

/** What a schema produces once parsed: each key narrowed to its declared type. */
type Parsed<S extends EnvSchema> = {
  readonly [K in keyof S]: S[K] extends { type: 'number' }
    ? number
    : S[K] extends { type: 'boolean' }
      ? boolean
      : string;
};

/** Raised when a key is missing or cannot be read as its declared type. */
export class EnvError extends Error {
  /** The offending key. Never the value — see the file header. */
  readonly key: string;

  constructor(key: string, reason: string) {
    super(`env ${key}: ${reason}`);
    this.name = 'EnvError';
    this.key = key;
  }
}

/**
 * ⛔ THE THREE VALUES THAT MEAN "ABSENT", AND WHY IT IS NOT JUST THE EMPTY STRING.
 *   An unbound workerd binding does NOT arrive as undefined — `fromEnvironment` produces
 *   the four-character STRING "null", because the binding is present and String(null) is
 *   truthy. Code that checks only for '' therefore accepts it, and the request goes out
 *   as `Authorization: Bearer null`.
 * 🔴 MEASURED IN THIS ESTATE, 2026-09-02. Twenty hand-rolled clients; this guard was in
 *   four of them. The other sixteen surfaced a bare 401 from upstream — which reads as
 *   "the token is wrong" and sends an operator to rotate a perfectly good credential.
 *   The litellm server spent a day authenticating with nothing while /health answered 200.
 *   Ported from house/mcp-servers/packages/kit/src/http.ts, where it was paid for once.
 */
export function isUnset(value: string): boolean {
  return value === '' || value === 'null' || value === 'undefined';
}

/**
 * ⚠️ 'false' IS TRUTHY AS A STRING, and that is the bug this function exists to stop.
 *   `Boolean(env.FEATURE)` on the string 'false' is `true`, so a flag turned off in a
 *   dashboard stays on in production and nothing in the logs says why. Only the listed
 *   spellings are accepted; anything else throws rather than guessing.
 */
const TRUE = new Set(['1', 'true', 'yes', 'on']);
const FALSE = new Set(['0', 'false', 'no', 'off']);

/**
 * Read `source` against `schema`, throwing `EnvError` on the first key that is missing
 * or malformed.
 *
 * ★ THROWS RATHER THAN RETURNING A RESULT, deliberately: this runs once at startup or
 *   at the top of a fetch handler, where a misconfigured deployment should fail loudly
 *   and immediately rather than produce a half-configured app that fails later somewhere
 *   less obvious.
 */
export function parseEnv<const S extends EnvSchema>(
  schema: S,
  source: Readonly<Record<string, unknown>>,
): Parsed<S> {
  const out: Record<string, string | number | boolean> = {};

  for (const key of Object.keys(schema)) {
    const spec = schema[key] as EnvSpec;
    const raw = source[key];

    // ⛔ isUnset, not `=== ''`. See its comment: "null" is what an unbound workerd
    //   binding actually looks like, and treating it as a value is a day-long debug.
    if (raw === undefined || raw === null || isUnset(String(raw).trim())) {
      if (spec.default !== undefined) {
        out[key] = spec.default;
        continue;
      }
      if (spec.optional === true) continue;
      throw new EnvError(key, 'required but not set');
    }

    // ⚠️ Trimmed: a rendered env file with a trailing newline is the common case, and an
    //   untrimmed token fails upstream with the same unhelpful 401.
    const text = String(raw).trim();

    if (spec.type === 'number') {
      const n = Number(text);
      // ⚠️ Number('') is 0 and Number(' ') is 0; the empty check above is what makes
      //   this safe. NaN is the only remaining failure and it is caught here.
      if (!Number.isFinite(n)) throw new EnvError(key, 'expected a number');
      out[key] = n;
    } else if (spec.type === 'boolean') {
      const lowered = text.toLowerCase();
      if (TRUE.has(lowered)) out[key] = true;
      else if (FALSE.has(lowered)) out[key] = false;
      else throw new EnvError(key, 'expected one of 1/true/yes/on or 0/false/no/off');
    } else {
      out[key] = text;
    }
  }

  return out as Parsed<S>;
}
