/**
 * The Cloudflare REST API as an Effect service, over `cloudflare-typescript`. Codex standard 5:
 * the vendor's SDK, never a hand-rolled client — and never a hand-rolled `fetch` either.
 *
 * ⛔ THE SDK WAS ALREADY IN THE STORE AND DECLARED BY NOBODY. Measured 2026-09-15:
 *   `node_modules/.pnpm/cloudflare@4.5.0` exists as a transitive dependency of `alchemy`, and
 *   `pnpm ls cloudflare --depth 0` at the root and in every workspace package returns nothing.
 *   `<estate>/local/scripts/vendor-sdk-ratchet.ts` row R2 says exactly that — "not declared anywhere
 *   in the workspace yet … the row adds the dependency once, then converts the TS callers" — so
 *   this package is that row's first half, and the twenty ratcheted offences keep their rows.
 *
 * ⛔ AND IT IS PINNED EXACTLY, NOT `catalog:`. There is no catalog entry for `cloudflare`, and the
 *   version that resolves today is the one alchemy pulls in. Pinning `4.5.0` means a future
 *   alchemy bump moves alchemy's copy and not this package's contract — the alternative is a
 *   provider whose request shape changes because an unrelated dependency was upgraded.
 *
 * ⚠️ `fetch` IS A SEAM, NOT A CONVENIENCE — the same argument `packages/litellm-client` makes. The
 *   SDK hands its custom fetch the URL and init it built, so a test double conforming to
 *   `Core.Fetch` exercises the real path assembly, the real body serialisation and the real header
 *   set. A test that stubbed `client.r2.buckets.locks.update` would prove only that a stub was
 *   called, which is precisely the class of check this estate keeps finding green over nothing.
 */
import Cloudflare from 'cloudflare';
import * as Config from 'effect/Config';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';

/** What the SDK accepts for `fetch`, restated so tests can name it without importing SDK internals. */
export type ClientFetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class CloudflareApi extends Context.Service<CloudflareApi, Cloudflare>()(
  'homeflare/CloudflareApi',
) {}

/**
 * ⚠️ THE FAKE FETCH IS THE ONLY REASON THIS TAKES OPTIONS AT ALL. Everything else the SDK reads
 *   from the environment the estate CLI already populates.
 */
export const makeClient = (options: { apiToken: string; fetch?: ClientFetch }): Cloudflare =>
  new Cloudflare({
    apiToken: options.apiToken,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

/**
 * ⛔ FAIL CLOSED ON THE VALUE, NEVER ON THE VARIABLE EXISTING. AGENTS.md "the four that cost the
 *   most" §4: a denied OpenBao path renders the template EMPTY rather than erroring, and every
 *   Cloudflare call then answers 403 exactly like a revoked token — which sends the operator to
 *   Cloudflare to rotate a credential that was fine. Your deploy wrapper should write
 *   CLOUDFLARE_API_TOKEN from the stack's declared role, short-lived and scoped.
 */
const MISSING_TOKEN =
  'CLOUDFLARE_API_TOKEN is not set. Mint a short-lived, scoped token and export it before ' +
  'role named in estate.stack.ts; running `alchemy` directly skips that and there is no default.';

const EMPTY_TOKEN =
  'CLOUDFLARE_API_TOKEN is set but EMPTY. That is a denied or missing OpenBao grant on the ' +
  'stack’s role, not a rotated token — re-mint it rather than rotating anything at Cloudflare.';

/**
 * ⛔ A LAYER'S ERROR CHANNEL MUST BE `never`, so a ConfigError becomes a defect carrying a sentence
 *   rather than a type error pushed up into `Stack`. Same decision, same words, as `LiteLLMLive`.
 */
export const CloudflareApiLive = Layer.effect(
  CloudflareApi,
  Effect.gen(function* () {
    const token = yield* Config.Redacted('CLOUDFLARE_API_TOKEN').pipe(
      Effect.catchTag('ConfigError', () => Effect.die(new Error(MISSING_TOKEN))),
    );
    const value = Redacted.value(token);
    if (value.length === 0) return yield* Effect.die(new Error(EMPTY_TOKEN));
    return makeClient({ apiToken: value });
  }),
);
