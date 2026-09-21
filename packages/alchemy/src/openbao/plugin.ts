/**
 * An OpenBao plugin catalog entry — `sys/plugins/catalog/<type>/<name>`: which binary in
 * plugin_directory, at which SHA-256, may run as a plugin of that name. METADATA ONLY.
 *
 * ⛔ IT REGISTERS; IT DOES NOT DELIVER. The binary must already sit in plugin_directory. Copying it
 *   there is a host step.
 *   ⚠️ A MISSING FILE FAILS THE WRITE; A WRONG SHA-256 DOES NOT. setInternal (plugin_catalog.go
 *     :1150-1230) resolves the path first, which fails loudly, but the run that would notice a
 *     checksum mismatch is only the version probe, and that is best-effort: it logs a warning and
 *     stores the entry anyway. The mismatch then surfaces when a mount first starts the plugin.
 * ⛔ NO `env` PROP, AND THERE MUST NEVER BE ONE — see registerBody in plugin-form.ts. Alchemy keeps
 *   props and attributes UNENCRYPTED in its state store (policy.ts has the reasoning).
 * ⚠️ A NEW SHA-256 DOES NOT RESTART A RUNNING PLUGIN. setInternal writes the catalog entry and
 *   reloads nothing, so mounts keep the old process until `sys/plugins/reload/backend` or a
 *   restart. Reloading is an operator step, not this resource.
 *
 * ★ `defaultRemovalPolicy: 'retain'`. Deregistering does not check whether a mount still runs the
 *   plugin (the ⛔ on deregisterPlugin in plugin-wire.ts), so a destroy would break that mount at its
 *   next start. Retain also means a version bump — a REPLACE, below — leaves the old version
 *   registered for mounts pinned to it; prune it by hand once nothing uses it.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { type BaoPluginAttributes, type BaoPluginProps, matches, resolve } from './plugin-form.ts';
import { readEntry, reconcilePlugin } from './plugin-reconcile.ts';
import { deregisterPlugin } from './plugin-wire.ts';

export type { BaoPluginAttributes, BaoPluginProps, BaoPluginType } from './plugin-form.ts';

export interface BaoPlugin extends Resource<
  'Bao.Plugin',
  BaoPluginProps,
  BaoPluginAttributes,
  never,
  HttpClient.HttpClient
> {}

export const BaoPlugin = Resource<BaoPlugin>('Bao.Plugin', {
  defaultRemovalPolicy: 'retain',
});

export const BaoPluginProvider = () =>
  Provider.effect(
    BaoPlugin,
    Effect.succeed(
      BaoPlugin.Provider.of({
        /**
         * ⛔ THE CATALOG IS NOT A LIST OF THINGS THIS OWNS. It answers every builtin plugin and
         *   every hand registration. Returning them would invite Alchemy to adopt — and then
         *   deregister — plugins it never registered.
         */
        list: () => Effect.succeed([]),

        read: Effect.fn(function* ({ olds }) {
          const found = yield* readEntry(resolve(olds));
          return found?.attributes;
        }),

        /** ⛔ IT COMPARES THE LIVE ENTRY, NOT THE STORED DIGEST — a hand re-register is drift. */
        diff: Effect.fn(function* ({ news, output }) {
          if (output === undefined || !isResolved(news)) return undefined;
          const form = resolve(news);
          /**
           * ⛔ NAME, TYPE AND VERSION ARE THE CATALOG KEY, so changing one is a different entry,
           *   not an edit. Writing the new key would leave the old registration in place under a
           *   state record that no longer names it.
           */
          if (
            output.name !== form.name ||
            output.type !== form.type ||
            output.version !== form.version
          ) {
            return { action: 'replace' } as const;
          }
          const found = yield* readEntry(form);
          if (found === undefined) return { action: 'update' } as const;
          return matches(found.attributes, form)
            ? ({ action: 'noop' } as const)
            : ({ action: 'update' } as const);
        }),

        /** The refusals — declarative, builtin, self-reported version — live in plugin-reconcile.ts. */
        reconcile: Effect.fn(function* ({ news }) {
          return yield* reconcilePlugin(news);
        }),

        /**
         * ⛔ READ THE ⛔ ON deregisterPlugin FIRST: nothing checks that a mount still runs this.
         *   Idempotent as Alchemy requires — already gone is success on the server.
         */
        delete: Effect.fn(function* ({ output }) {
          yield* deregisterPlugin(output.type, output.name, output.version);
          return undefined;
        }),
      }),
    ),
  );
