/**
 * CaddyConfig's diff / reconcile — the apply half of the lifecycle config-lifecycle.ts's
 * `desiredConfig`/`readLive`/`probeLive` compute the inputs for. Split out at the 250-line file
 * cap; the two files together are one lifecycle, read config-lifecycle.ts's module doc first.
 */
import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import type * as Diff from 'alchemy/Diff';
import type * as Caddy from '@distilled.cloud/caddy';
import { CaddyAdminService } from './admin.ts';
import { loadCaddyfile, readRunningConfig } from './admin-calls.ts';
import { isUnreachable } from './caddy-http-client.ts';
import { messageOf, refuse, short, wrapOperation } from './config-errors.ts';
import type { CaddyConfigAttributes, CaddyConfigProps } from './config-form.ts';
import { claimable, desiredConfig, readLive } from './config-lifecycle.ts';
import { configDigest } from './digest.ts';

/**
 * ★ NEVER `replace`. Nothing in the props names a different object: a new Caddyfile is a reload of
 *   the same Caddy, and `sourceFile` is a header. (Which Caddy is the transport's business — see
 *   the ⚠️ on `endpoint` in the diff.)
 */
export const diffConfig = (
  news: CaddyConfigProps,
  output: CaddyConfigAttributes,
): Effect.Effect<Diff.Diff, Error | Caddy.CaddyOpError, CaddyAdminService | Caddy.CaddyOpContext> =>
  Effect.gen(function* () {
    const { endpoint } = yield* CaddyAdminService;
    const want = yield* desiredConfig(news);
    const live = yield* readLive();
    const converged =
      want.digest === live.configSha256 &&
      live.configSha256 === output.configSha256 &&
      news.sourceFile === output.sourceFile &&
      // ⚠️ A stack whose transport now reaches ANOTHER Caddy (a new address) must load there; the
      //   old one keeps what it has — the same as a delete, which never unloads (see config.ts).
      //   Planned as an update, but the state does not vouch for that Caddy: see Authority.
      endpoint === output.endpoint;
    return converged ? { action: 'noop' } : { action: 'update' };
  });

export type Applied = {
  readonly attributes: CaddyConfigAttributes;
  /** The adapter's warnings (e.g. "Caddyfile input is not formatted") — log them, never refuse. */
  readonly warnings: readonly string[];
  /** Whether a `POST /load` was sent (false when Caddy already ran this config). */
  readonly loaded: boolean;
};

/**
 * What this apply may load over — config.ts decides from the state and the adopt setting:
 *   · `takeOver` — any running config: the state was applied to THIS Caddy (an update, drift
 *     correction, or a create the engine adopted), or adoption is on (`--adopt`, or the
 *     resource's own `adopt(true)` — ownership/adopt.ts adoptEnabled).
 *   · otherwise only a claimable one — plus, as `stored`, the digest the state last recorded: a
 *     Caddy reached at a NEW endpoint that runs exactly that is the same config under another name.
 */
export type Authority = { readonly takeOver: boolean; readonly stored?: string };

/**
 * Load the Caddyfile unless Caddy already runs it, then read it back and insist it matches.
 * ⛔ WITHOUT `takeOver`, A CONFIG THE STACK CANNOT CLAIM IS NEVER LOADED OVER. The engine's adoption
 *   probe cannot guard every create: it is skipped while `news` holds an Output — ALWAYS on
 *   caddyWithFile's first deploy (`sourceFile` is its HostFile's path) — and a Caddy that was down at
 *   plan time read as nothing. Nor does state vouch for a Caddy the transport NOW reaches at another
 *   endpoint (diff plans that as an update). Refused here, before any `/load`, like HostFile's.
 */
export const reconcileConfig = (
  props: CaddyConfigProps,
  authority: Authority,
): Effect.Effect<Applied, Error | Caddy.CaddyOpError, CaddyAdminService | Caddy.CaddyOpContext> =>
  Effect.gen(function* () {
    const { endpoint } = yield* CaddyAdminService;
    const want = yield* desiredConfig(props);
    const running = yield* readRunningConfig().pipe(wrapOperation(endpoint, 'GET /config/'));
    const before = configDigest(running);
    const known = before === authority.stored || claimable(running, want.digest);
    if (!authority.takeOver && !known) {
      return yield* Effect.fail(
        refuse(
          endpoint,
          `Caddy runs config ${short(before)}, which this stack did not load, and the Caddyfile ` +
            `adapts to ${short(want.digest)} — loading it would replace every site that config ` +
            'serves. Deploy with --adopt (or wrap the resource in adopt(true)) to take this Caddy ' +
            'over, or point caddyProviders() at the Caddy you meant.',
        ),
      );
    }
    let warnings = want.warnings;
    const loaded = before !== want.digest;
    if (loaded) {
      const outcome = yield* Effect.result(loadCaddyfile(props.caddyfile, props.sourceFile));
      if (Result.isFailure(outcome)) {
        const error = outcome.failure;
        // ⚠️ Caddy going unreachable MID-load is not a refusal — nothing to "say what's running
        //   now" about, and re-sending it is unsafe (admin-calls.ts's module doc). Propagated raw,
        //   still narrowable, matching every other unreachable path in this file.
        if (isUnreachable(error)) return yield* Effect.fail(error);
        // ★ SAY WHAT IS RUNNING NOW. Caddy restores the previous config on a failed load (caddy.go
        //   changeConfig); confirm it rather than promise it, because the deploy log is where the
        //   person decides whether sites are down.
        const afterRead = yield* Effect.result(readLive());
        const after = Result.isSuccess(afterRead) ? afterRead.success : undefined;
        const state =
          after === undefined
            ? 'and the running config could not be read back'
            : after.configSha256 === before
              ? 'Caddy kept the previous config (still serving)'
              : `and the running config is now ${short(after.configSha256)}, not the previous ${short(before)}`;
        // ⚠️ SAY SO WHEN THE STATUS LIED, or a bare "refused" reads like a normal 4xx/5xx.
        //   `LoadRefused` IS the 200-embedded-error trap (admin-calls.ts's module doc): Caddy
        //   answered 200, and the failure was only in the body.
        const reason =
          error._tag === 'LoadRefused'
            ? `${error.message} (LoadRefused: a 200 whose body carried the error, not a failure status)`
            : messageOf(error);
        return yield* Effect.fail(
          refuse(endpoint, `Caddy refused the Caddyfile — ${reason}; ${state}`),
        );
      }
      warnings = outcome.success;
    }
    // ⚠️ READ BACK, never echo the declaration: a concurrent writer, or a load Caddy answered 200 but
    //   did not apply (admin-calls.ts), shows up here as a refusal instead of as stored state that is
    //   already wrong.
    const attributes = yield* readLive(props.sourceFile);
    if (attributes.configSha256 !== want.digest) {
      return yield* Effect.fail(
        refuse(
          endpoint,
          `after the load Caddy runs config ${short(attributes.configSha256)}, not the ` +
            `${short(want.digest)} this Caddyfile adapts to — another writer changed it, or it was ` +
            'not applied',
        ),
      );
    }
    return { attributes, loaded, warnings };
  });
