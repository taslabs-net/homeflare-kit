/**
 * `Caddy.Config` — a running Caddy's whole config, declared as Caddyfile text and applied through
 * Caddy's own admin API (decision 23).
 *
 * - create / update — `POST /adapt` (validate), `POST /load` with `text/caddyfile` (a graceful
 *   reload; Caddy keeps the old config if it refuses the new one, and the error names why), then
 *   `GET /config/` and insist it matches. Skipped when Caddy already runs this config.
 * - read — the digest of `GET /config/`. ★ WITH NO STATE, A RUNNING CADDY IS ADOPTED: its live
 *   config becomes the starting point, and the deploy's forced update loads the declared one.
 * - diff — declared, live and stored digests (config-lifecycle.ts). Never `replace`.
 * - delete — ⛔ NOTHING. See below.
 *
 * ⛔ DELETE NEVER TOUCHES CADDY, UNDER EITHER REMOVAL POLICY. Removing this declaration must not take
 *   every site down: there is no "less config" to fall back to, and an empty config stops all
 *   servers. `retain` is the default (the engine never calls delete); with `destroy` the handler
 *   still only forgets. It never calls `/stop` (which exits the process) or `DELETE /config/`.
 *   To empty a Caddy, do it by hand at its admin API.
 * ⛔ `caddyfile` IS NEVER A SECRET — see config-form.ts; refused before anything is sent.
 * ⚠️ WHICH CADDY is the transport's (providers.ts), not a prop: one CaddyAdmin per stack.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { lift, resolvedString } from '../launchd/host-effect.ts';
import { CaddyAdminService, CaddyUnreachableError } from './admin.ts';
import type { CaddyConfigAttributes, CaddyConfigProps } from './config-form.ts';
import { diffConfig, readLive, reconcileConfig } from './config-lifecycle.ts';

export type { CaddyConfigAttributes, CaddyConfigProps } from './config-form.ts';

export interface CaddyConfig extends Resource<
  'Caddy.Config',
  CaddyConfigProps,
  CaddyConfigAttributes
> {}

export const CaddyConfig = Resource<CaddyConfig>('Caddy.Config', {
  defaultRemovalPolicy: 'retain',
});

const unreachable = (error: Error): error is CaddyUnreachableError =>
  error instanceof CaddyUnreachableError;

/**
 * ⚠️ A STOPPED CADDY MUST NOT FAIL THE PLAN THAT BRINGS IT BACK. Its launchd job usually sits in the
 *   same stack; if every plan died on `ECONNREFUSED`, the fix to that job could never be deployed.
 *   So at PLAN time only (read, diff) an unreachable Caddy plans an update — with a warning, because
 *   the plan-time `/adapt` check did not run — and reconcile, which needs Caddy, still fails loudly.
 */
const planWithoutCaddy =
  <A>(admin: { endpoint: string }, fallback: A) =>
  (error: Error) =>
    Effect.as(
      Effect.logWarning(
        `Caddy.Config: no Caddy at ${admin.endpoint} (${error.message}); planning without it — ` +
          'the Caddyfile is validated when the deploy reaches Caddy',
      ),
      fallback,
    );

export const CaddyConfigProvider = () =>
  Provider.effect(
    CaddyConfig,
    Effect.gen(function* () {
      const admin = yield* CaddyAdminService;
      return CaddyConfig.Provider.of({
        /** ⛔ A Caddy has one config; there is nothing to enumerate, and nothing for nuke to delete. */
        list: () => Effect.succeed([]),

        /**
         * ★ Plain attributes, never `Unowned`: a Caddy on this host's loopback admin API is the one
         *   the stack means (the transport refuses anything else), and adopting reads — it changes
         *   nothing until reconcile loads the declared Caddyfile.
         */
        read: ({ olds }) =>
          lift(() => readLive(admin, resolvedString(olds, 'sourceFile'))).pipe(
            // ★ Nothing to adopt from a Caddy that is down: plan a create, which is the same load.
            Effect.catchIf(unreachable, planWithoutCaddy(admin, undefined)),
          ),

        diff: ({ news, output }) => {
          if (output === undefined) return Effect.succeed(undefined);
          const update = planWithoutCaddy(admin, { action: 'update' as const });
          if (isResolved(news)) {
            return lift(() => diffConfig(admin, news, output)).pipe(
              Effect.catchIf(unreachable, update),
            );
          }
          /**
           * ⚠️ `sourceFile` is an Output while its HostFile changes in the same deploy
           *   (caddyWithFile). The Caddyfile itself is usually plain text, so validate and compare
           *   it now — a bad Caddyfile must fail the PLAN, before the HostFile writes it to disk —
           *   and plan an update, which reloads only if the config really differs.
           */
          const caddyfile = resolvedString(news, 'caddyfile');
          if (caddyfile === undefined) return Effect.succeed(undefined);
          return lift(async () => {
            await diffConfig(admin, { caddyfile }, output);
            return { action: 'update' as const };
          }).pipe(Effect.catchIf(unreachable, update));
        },

        reconcile: ({ news }) =>
          Effect.gen(function* () {
            const applied = yield* lift(() => reconcileConfig(admin, news));
            for (const warning of applied.warnings) {
              yield* Effect.logWarning(`Caddy.Config at ${admin.endpoint}: ${warning}`);
            }
            return applied.attributes;
          }),

        delete: () => Effect.void,
      });
    }),
  );
