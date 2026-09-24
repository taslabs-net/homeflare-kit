/**
 * `Caddy.Config` — a running Caddy's whole config, declared as Caddyfile text and applied through
 * Caddy's own admin API (decision 23), via `@distilled.cloud/caddy`'s typed `admin` operations.
 *
 * - create / update — `POST /adapt` (validate), `POST /load` with `text/caddyfile` (a graceful
 *   reload; Caddy keeps the old config if it refuses the new one, and the error names why), then
 *   `GET /config/` and insist it matches. Skipped when Caddy already runs this config.
 * - read — the digest of `GET /config/`. With no state it is the adoption probe (below).
 * - diff — declared, live and stored digests (config-lifecycle.ts). Never `replace`.
 * - delete — ⛔ NOTHING. See below.
 *
 * ⛔ DELETE NEVER TOUCHES CADDY, UNDER EITHER REMOVAL POLICY. Removing this declaration must not take
 *   every site down: there is no "less config" to fall back to, and an empty config stops all
 *   servers. `retain` is the default (the engine never calls delete); with `destroy` the handler
 *   still only forgets. It never calls `/stop` (which exits the process) or `DELETE /config/`.
 *   To empty a Caddy, do it by hand at its admin API.
 * ⛔ NOTHING IS ADOPTED SILENTLY (decision, 2026-09-21 — the house rule HostFile and LaunchdJob
 *   keep). With no state, a running Caddy whose live config IS the declared one reads as ours (the
 *   adoption changes nothing); any other config reads as `Unowned`, and the plan refuses it unless
 *   the deploy runs with `--adopt`. A Caddy serving nothing reads as absent: a create. Where the
 *   engine skips that probe, reconcile refuses the same takeover (config-lifecycle.ts).
 * ⛔ `caddyfile` IS NEVER A SECRET — see config-form.ts; refused before anything is sent.
 * ⚠️ WHICH CADDY is the transport's (providers.ts): `CaddyAdminService` plus the `Credentials`/
 *   `HttpClient` layers `caddyAdminLayer` merges — one per stack, not a prop.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { resolvedString } from '../launchd/host-effect.ts';
import { adoptEnabled } from '../ownership/adopt.ts';
import { CaddyAdminService } from './admin.ts';
import { isUnreachable } from './caddy-http-client.ts';
import type { CaddyConfigAttributes, CaddyConfigProps } from './config-form.ts';
import { probeLive, readLive } from './config-lifecycle.ts';
import { diffConfig, reconcileConfig } from './config-reconcile.ts';
import { formattingFixLine, splitFormattingWarning } from './format-warnings.ts';

export type { CaddyConfigAttributes, CaddyConfigProps } from './config-form.ts';

export interface CaddyConfig extends Resource<
  'Caddy.Config',
  CaddyConfigProps,
  CaddyConfigAttributes
> {}

export const CaddyConfig = Resource<CaddyConfig>('Caddy.Config', {
  defaultRemovalPolicy: 'retain',
});

/**
 * ⚠️ A STOPPED CADDY MUST NOT FAIL THE PLAN THAT BRINGS IT BACK. Its launchd job usually sits in the
 *   same stack; if every plan died on `ECONNREFUSED`, the fix to that job could never be deployed.
 *   So at PLAN time only (read, diff) an unreachable Caddy plans an update — with a warning, because
 *   the plan-time `/adapt` check did not run — and reconcile, which needs Caddy, still fails loudly.
 */
const planWithoutCaddy =
  <A>(admin: { endpoint: string }, fallback: A) =>
  (error: unknown) =>
    Effect.as(
      Effect.logWarning(
        `Caddy.Config: no Caddy at ${admin.endpoint} ` +
          `(${error instanceof Error ? error.message : String(error)}); planning without it — ` +
          'the Caddyfile is validated when the deploy reaches Caddy',
      ),
      fallback,
    );

export const CaddyConfigProvider = () =>
  Provider.effect(
    CaddyConfig,
    Effect.gen(function* () {
      const admin = yield* CaddyAdminService;
      /** The probe, branded for the engine: plain when ours, `Unowned` otherwise. */
      const probe = (caddyfile: string | undefined, sourceFile: string | undefined) =>
        Effect.flatMap(probeLive(caddyfile, sourceFile), (found) => {
          if (found === undefined) return Effect.succeed(undefined);
          if (found.ours) return Effect.succeed(found.attributes);
          const unowned = Unowned(found.attributes);
          return found.unchecked === undefined
            ? Effect.succeed(unowned)
            : Effect.as(
                Effect.logWarning(
                  `Caddy.Config at ${admin.endpoint}: the running config could not be compared ` +
                    `with the declared Caddyfile (${found.unchecked}), so it is not treated as ours`,
                ),
                unowned,
              );
        });
      return CaddyConfig.Provider.of({
        /** ⛔ A Caddy has one config; there is nothing to enumerate, and nothing for nuke to delete. */
        list: () => Effect.succeed([]),

        /**
         * With state: the live attributes, which diff compares. With none, the ADOPTION PROBE —
         * `olds` is the declaration (Plan.ts passes `news`), and only a live config equal to it is
         * ours. ⚠️ A running Caddy is still the one the stack means (the transport reaches only
         * loopback), but WHOSE CONFIG it runs is not: a person, another tool or another stack.
         */
        read: ({ olds, output }) =>
          Effect.gen(function* () {
            return output === undefined
              ? yield* probe(resolvedString(olds, 'caddyfile'), resolvedString(olds, 'sourceFile'))
              : yield* readLive(resolvedString(olds, 'sourceFile'));
          }).pipe(
            // ★ Nothing to adopt from a Caddy that is down: plan a create, which is the same load.
            Effect.catchIf(isUnreachable, planWithoutCaddy(admin, undefined)),
          ),

        diff: ({ news, output }) => {
          if (output === undefined) return Effect.succeed(undefined);
          const update = planWithoutCaddy(admin, { action: 'update' as const });
          if (isResolved(news)) {
            return diffConfig(news, output).pipe(Effect.catchIf(isUnreachable, update));
          }
          /**
           * ⚠️ `sourceFile` is an Output while its HostFile changes in the same deploy
           *   (caddyWithFile). The Caddyfile itself is usually plain text, so validate and compare
           *   it now — a bad Caddyfile must fail the PLAN, before the HostFile writes it to disk —
           *   and plan an update, which reloads only if the config really differs.
           */
          const caddyfile = resolvedString(news, 'caddyfile');
          if (caddyfile === undefined) return Effect.succeed(undefined);
          return Effect.as(diffConfig({ caddyfile }, output), { action: 'update' as const }).pipe(
            Effect.catchIf(isUnreachable, update),
          );
        },

        reconcile: ({ fqn, news, output }) =>
          Effect.gen(function* () {
            // ⛔ State is authority over the Caddy it was applied to, and no other. With none (the
            //   engine may not have probed: see reconcileConfig), or with the transport now at
            //   another endpoint, only adoption — `--adopt`, or this resource's own `adopt(…)`,
            //   as the planner resolves it — loads over a config the stack cannot claim.
            const sameCaddy = output !== undefined && output.endpoint === admin.endpoint;
            const takeOver = sameCaddy || (yield* adoptEnabled(fqn));
            const stored = output === undefined ? {} : { stored: output.configSha256 };
            const applied = yield* reconcileConfig(news, { takeOver, ...stored });
            // ★ THE FORMATTING WARNING GETS ITS OWN LINE, NAMING THE FIX — separate from the rest,
            //   which keep logging exactly as before (format-warnings.ts).
            const { formatting, rest } = splitFormattingWarning(applied.warnings);
            if (formatting.length > 0) {
              yield* Effect.logWarning(formattingFixLine(admin.endpoint));
            }
            for (const warning of rest) {
              yield* Effect.logWarning(`Caddy.Config at ${admin.endpoint}: ${warning}`);
            }
            return applied.attributes;
          }),

        delete: () => Effect.void,
      });
    }),
  );
