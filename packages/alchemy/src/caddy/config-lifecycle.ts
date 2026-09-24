/**
 * CaddyConfig's validate / read / probe as Effects over `@distilled.cloud/caddy`'s typed `admin`
 * operations (admin-calls.ts), so the lifecycle runs against a fake admin server in tests — and,
 * since fake-caddy.ts is a real HTTP server, against the real distilled wire protocol too.
 * config-reconcile.ts covers `diff`/`reconcile`, the other half of the same lifecycle.
 *
 * The comparison is always between DIGESTS OF ADAPTED JSON (digest.ts): what `POST /adapt` makes
 * of the declared Caddyfile and what `GET /config/` reports — `claimable` below asks whether a
 * running config is provably the declared one, which both the adoption probe and the apply need.
 */
import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import type * as Caddy from '@distilled.cloud/caddy';
import { CaddyAdminService } from './admin.ts';
import { adaptCaddyfile, readRunningConfig } from './admin-calls.ts';
import { adminProblems } from './admin-guard.ts';
import { isUnreachable } from './caddy-http-client.ts';
import { refuse, wrapOperation } from './config-errors.ts';
import {
  type CaddyConfigAttributes,
  type CaddyConfigProps,
  configProblems,
} from './config-form.ts';
import { configDigest } from './digest.ts';

type Desired = { readonly digest: string; readonly warnings: readonly string[] };

/**
 * ⛔ A CONFIG WITH NO APPS SERVES NOTHING. A Caddyfile of only comments or only global options
 *   passes the empty-text check (config-form.ts) yet adapts to `{}` or `{"admin":…}` — MEASURED
 *   2026-09-21 on a throwaway Caddy 2.11.4 — and loading it stops every server: the same outage,
 *   from the same templating bug, that the empty check exists to prevent.
 */
export const servesNothing = (config: unknown): boolean => {
  const apps =
    typeof config === 'object' && config !== null ? (config as { apps?: unknown }).apps : undefined;
  return typeof apps !== 'object' || apps === null || Object.keys(apps).length === 0;
};

/**
 * Validate the props, adapt the Caddyfile on the running Caddy, and check its `admin` block.
 * ★ Every refusal happens HERE, before anything is loaded — and diff calls this at plan time, so a
 *   Caddyfile that does not adapt, carries a literal secret, or would strand the admin API fails the
 *   PLAN, before any resource (a HostFile holding the same text included) is applied.
 */
export const desiredConfig = (
  props: CaddyConfigProps,
): Effect.Effect<Desired, Error | Caddy.CaddyOpError, CaddyAdminService | Caddy.CaddyOpContext> =>
  Effect.gen(function* () {
    const { endpoint, listener } = yield* CaddyAdminService;
    const found = configProblems(props);
    if (found.length > 0) return yield* Effect.fail(refuse(endpoint, found.join('; ')));
    const adapted = yield* adaptCaddyfile(props.caddyfile).pipe(
      wrapOperation(endpoint, 'POST /adapt'),
    );
    if (servesNothing(adapted.config)) {
      return yield* Effect.fail(
        refuse(endpoint, 'the Caddyfile adapts to no apps — loading it would stop every site'),
      );
    }
    const guard = adminProblems(adapted.config, listener);
    if (guard.length > 0) return yield* Effect.fail(refuse(endpoint, guard.join('; ')));
    return { digest: configDigest(adapted.config), warnings: adapted.warnings };
  });

export const attributesOf = (
  endpoint: string,
  running: unknown,
  sourceFile?: string,
): CaddyConfigAttributes => ({
  configSha256: configDigest(running),
  endpoint,
  ...(sourceFile === undefined ? {} : { sourceFile }),
});

/** What is running now, as attributes. `sourceFile` is carried over, never discovered. */
export const readLive = (
  sourceFile?: string,
): Effect.Effect<
  CaddyConfigAttributes,
  Error | Caddy.CaddyOpError,
  CaddyAdminService | Caddy.CaddyOpContext
> =>
  Effect.gen(function* () {
    const { endpoint } = yield* CaddyAdminService;
    const running = yield* readRunningConfig().pipe(wrapOperation(endpoint, 'GET /config/'));
    return attributesOf(endpoint, running, sourceFile);
  });

/**
 * ⛔ WITH NO STATE, A RUNNING CONFIG IS THIS STACK'S ONLY IF IT IS THE DECLARED ONE (decision,
 *   2026-09-21: CaddyConfig must not adopt silently — the house rule HostFile and LaunchdJob keep).
 *   Anything else was put there by a person, another tool or another stack, and loading over it
 *   replaces every site it serves. ★ A config that serves nothing (`null`, or no apps) is claimable
 *   too: there is nothing to take over, as an empty R2 lock rule set reads as no lock.
 */
export const claimable = (running: unknown, declaredDigest: string): boolean =>
  servesNothing(running) || configDigest(running) === declaredDigest;

export type Probe = {
  readonly attributes: CaddyConfigAttributes;
  /** The live config IS the declared one: adopting it changes nothing. */
  readonly ours: boolean;
  /** Why the declaration could not be compared, when it could not — the Caddy is then not ours. */
  readonly unchecked?: string;
};

/**
 * The adoption probe — `read` with no state: `undefined` when Caddy serves nothing (plan a create),
 * else the live attributes and whether they are provably ours (the provider brands the rest
 * `Unowned`, and the plan refuses them without `--adopt`).
 * ⛔ IT NEVER THROWS OVER THE DECLARATION. The engine also runs this read to recover an interrupted
 *   create, with THAT deploy's props (Plan.ts, `status: "creating"`) — so a Caddyfile that failed to
 *   adapt then would fail every later plan, the one carrying the fix included. What cannot be
 *   compared is "not proven ours", with the reason; the next diff or apply validates the Caddyfile.
 */
export const probeLive = (
  caddyfile: string | undefined,
  sourceFile?: string,
): Effect.Effect<Probe | undefined, Caddy.CaddyOpError, CaddyAdminService | Caddy.CaddyOpContext> =>
  Effect.gen(function* () {
    const { endpoint } = yield* CaddyAdminService;
    // ⚠️ NOT wrapOperation here: an unreachable Caddy must still raise the raw, narrowable
    //   HttpClientError (config.ts's plan-time escape hatch), and every OTHER failure reading the
    //   running config mid-probe is "not proven ours" below, never a thrown refusal.
    const running = yield* readRunningConfig();
    if (servesNothing(running)) return undefined;
    const attributes = attributesOf(endpoint, running, sourceFile);
    if (caddyfile === undefined) {
      return { attributes, ours: false, unchecked: 'the stored Caddyfile is not plain text' };
    }
    // ⚠️ Unreachable mid-probe is still "no Caddy" (config.ts plans without it), not "not ours" —
    //   re-failed with the raw, still-narrowable error, never swallowed into `unchecked`. Every
    //   OTHER refusal desiredConfig raises mid-probe (a bad admin block, a Caddyfile that will not
    //   adapt) is "not proven ours", with the reason — never a thrown refusal over the DECLARATION
    //   (the ⛔ above). `Effect.result`, per S20, rather than a `catchAll` this Effect version
    //   does not export.
    const desired = yield* Effect.result(desiredConfig({ caddyfile }));
    if (Result.isSuccess(desired)) {
      return { attributes, ours: claimable(running, desired.success.digest) };
    }
    if (isUnreachable(desired.failure)) return yield* Effect.fail(desired.failure);
    const cause = desired.failure;
    return {
      attributes,
      ours: false,
      unchecked: cause instanceof Error ? cause.message : String(cause),
    };
  });
