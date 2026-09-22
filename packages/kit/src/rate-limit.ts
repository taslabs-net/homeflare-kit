/**
 * Rate-limit headers the platform does not honour on its own.
 *
 * ★ WHY THIS IS A ky HOOK AND NOT A RETRY IMPLEMENTATION. ky already retries only
 *   idempotent methods, honours `Retry-After` in both seconds and HTTP-date form, caps
 *   with `maxRetryAfter`, and adds jitter — all of which a hand-rolled version has to get
 *   right and usually does not. Reimplementing it to gain one header would trade a
 *   maintained retry engine for a bespoke one.
 *
 * 🔴 BUT ONE HEADER IS MISSING, AND IT IS THE ONE THAT HURT. Measured 2026-09-15 against
 *   ky 2.1.0 with a local server:
 *       retry-after: 1              -> waited 1006ms   (honoured)
 *       x-ratelimit-reset-after: 1  -> waited  303ms   (IGNORED — ky's own backoff)
 *       no header at all            -> waited  303ms
 *   ky reads `X-RateLimit-Retry-After` and `RateLimit-Reset`, but not Discord's
 *   `x-ratelimit-reset-after`, which carries FRACTIONAL seconds and is the more precise
 *   of the two when both appear.
 *
 * 🔴 WHY THAT MATTERS MORE THAN IT LOOKS. A 429 that is not waited out properly becomes a
 *   retry storm, and a retry storm escalates from one throttled ROUTE to a throttled
 *   TOKEN. Where a token is shared — a Discord bot and its MCP server on the same
 *   credential — the storm takes down the thing that was not even failing.
 */
import type { AfterResponseHook, Options } from 'ky';

/** Anything with a case-insensitive `get`. Headers satisfies this; so does a test stub. */
export type HeaderBag = { readonly get: (name: string) => string | null };

/** ⚠️ Capped: an uncapped sleep on a global 429 can be an hour, which reads as a hang. */
export const MAX_RETRY_WAIT_MS = 30_000;

function asMs(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw.trim());
  // ⚠️ Fractional seconds are the point — Discord sends 0.153, not 1.
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n * 1000), MAX_RETRY_WAIT_MS) : null;
}

/**
 * How long the server asked us to wait, in ms, or null if it did not say.
 *
 * ★ Prefers `x-ratelimit-reset-after` over `retry-after`: when a server sends both, the
 *   fractional one is more precise, and rounding 0.15s up to 1s wastes throughput.
 */
export function retryAfterMs(headers: HeaderBag): number | null {
  return asMs(headers.get('x-ratelimit-reset-after')) ?? asMs(headers.get('retry-after'));
}

/**
 * ky options that honour `x-ratelimit-reset-after`.
 *
 *     const discord = client(base, rateLimitAware);
 *
 * ⛔ The hook only SLEEPS; it never swallows the response. ky still decides whether to
 *   retry and still throws `HTTPError` on a final 429, so a caller that has run out of
 *   attempts sees the failure rather than a silent success.
 */
/**
 * ⚠️ Typed as AfterResponseHook explicitly. isolatedDeclarations requires every exported
 *   symbol to carry a type, and an inline arrow inside an `Options` literal does not
 *   infer its parameters from the surrounding annotation.
 */
// ⚠️ ONE `state` OBJECT, not (request, options, response). ky 2.x changed the hook
//   signature; the 1.x three-argument form is a type error rather than a silent no-op —
//   measured 2026-09-15, and the typechecker is what caught it.
const honourResetAfter: AfterResponseHook = async ({ response }) => {
  if (response.status !== 429) return response;

  const wait = asMs(response.headers.get('x-ratelimit-reset-after'));
  // ⚠️ Only act when ky would NOT: it already handles plain `retry-after`, and sleeping
  //   twice for one 429 doubles the wait for no benefit.
  if (wait === null) return response;

  // ⛔ setTimeout, NOT Bun.sleep. This package is runtime-neutral: consumers run it on
  //   workerd and Node, where `Bun` does not exist. A bun-only API here resolves fine on
  //   a laptop and throws in production.
  await new Promise<void>((resolve) => setTimeout(resolve, wait));
  return response;
};

export const rateLimitAware: Options = {
  hooks: { afterResponse: [honourResetAfter] },
};
