/**
 * HTTP client — a configured `ky`, not a wrapper around it.
 *
 * ★ WHY ky AND NOT A HAND-ROLLED fetch+retry. Retry, timeout and backoff are each easy
 *   to write and easy to write subtly wrong (retrying a POST, retrying a 4xx, a timeout
 *   that leaks the AbortController). ky is zero-dependency, TypeScript-native and
 *   fetch-based — measured 2026-09-15: `npm view ky dependencies` is empty — so it adds
 *   nothing to a consumer's tree.
 *   ⚠️ ky is described as browser-first, which matters only in that it assumes a global
 *     `fetch`. workerd, Node 18+ and Bun all provide one, so there is nothing to polyfill.
 *   ⛔ NOT ofetch (pulls destr + node-fetch-native) and NOT wretch, which is BROKEN on
 *     Workers out of the box: Cloudflare's Response has no `.type` and wretch throws
 *     reading it, needing a middleware patch to work at all.
 *
 * ★ THIS MODULE IS DELIBERATELY THIN. It re-exports ky's own types rather than inventing
 *   parallel ones, so a caller who needs something not covered here uses ky directly and
 *   loses nothing.
 */
import ky, { HTTPError, type KyInstance, type Options, TimeoutError } from 'ky';

export { HTTPError, TimeoutError };
export type { KyInstance, Options };

/**
 * The house defaults.
 *
 * ⚠️ ky retries only IDEMPOTENT methods by default (GET/PUT/HEAD/DELETE/OPTIONS/TRACE) —
 *   POST is excluded, which is the behaviour you want and the one a hand-rolled retry
 *   usually gets wrong. Retried status codes are 408/413/429/500/502/503/504.
 * ⚠️ `timeout` is PER ATTEMPT, not for the whole call. With limit 3 and a 10s timeout the
 *   worst case is ~30s plus backoff — shorten both for a Worker on a request path, where
 *   the CPU-time limit is unforgiving.
 */
export const http: KyInstance = ky.extend({
  retry: { limit: 3, backoffLimit: 3_000 },
  timeout: 10_000,
});

/**
 * A client bound to one base URL, for talking to a specific service.
 *
 *     const linear = client('https://api.linear.app', { headers: { authorization } });
 *     const issues = await linear.get('/graphql').json<Issues>();
 *
 * ⚠️ `baseUrl`, NOT `prefixUrl`. ky 2.x renamed the option and changed its semantics:
 *   `baseUrl` resolves per the URL standard, so a leading slash is fine and an absolute
 *   input bypasses the base. (ky 1.x had `prefixUrl`, which threw on a leading slash —
 *   measured 2026-09-15, the old name is a type error, not a silent no-op.)
 */
export function client(baseUrl: string, options?: Options): KyInstance {
  return http.extend({ ...options, baseUrl });
}
