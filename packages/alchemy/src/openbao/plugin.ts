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
import { claimFor } from '../ownership/adopt.ts';
import { ownedRead } from '../ownership/probe.ts';
import { noteResume } from '../ownership/resume.ts';
import {
  type BaoPluginAttributes,
  type BaoPluginProps,
  type BaoPluginType,
  matches,
  problems,
  resolve,
  versionedPath,
} from './plugin-form.ts';
import { readEntry, reconcilePlugin } from './plugin-reconcile.ts';
import { deregisterPlugin } from './plugin-wire.ts';
import { declaredOr, declaredString } from './rename.ts';
import { type Identity, guardRename, judgeRename } from './rename-identity.ts';

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

/**
 * ⛔ NAME, TYPE AND VERSION ARE THE CATALOG KEY, so the identity is the versioned path a read and a
 *   delete address. Exact: the catalog stores `<type>/<name>/<version>` as given, and the version
 *   is already canonical (`problems`). ⚠️ An unversioned name that is a builtin reads back as
 *   present (plugin-wire.ts), so a move onto one fails the plan, as reconcile would refuse anyway.
 */
const IDENTITY: Identity<BaoPluginAttributes> = {
  declared: (props) => {
    const type = declaredString(props, 'type') as BaoPluginType | undefined;
    const name = declaredString(props, 'name');
    const version = declaredOr(props, 'version', '');
    if (type === undefined || name === undefined || version === undefined) return undefined;
    return versionedPath(type, name, version);
  },
  family: 'Bao.Plugin',
  recorded: (output) => versionedPath(output.type, output.name, output.version),
};

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

        /** ⛔ Stateless: `Unowned` unless our own interrupted create made it (ownership/probe.ts). */
        read: Effect.fn(function* ({ fqn, instanceId, olds, output }) {
          const form = resolve(olds);
          const found = yield* readEntry(form);
          const ours = Effect.sync(
            () =>
              found !== undefined && problems(form).length === 0 && matches(found.attributes, form),
          );
          return yield* ownedRead({ fqn, instanceId, output }, found?.attributes, ours);
        }),

        /** ⛔ IT COMPARES THE LIVE ENTRY, NOT THE STORED DIGEST — a hand re-register is drift. */
        diff: Effect.fn(function* ({ instanceId, news, olds, output }) {
          /**
           * ⛔ A NEW NAME, TYPE OR VERSION IS A DIFFERENT ENTRY, not an edit: `replace`, judged
           *   before `isResolved(news)`. Writing the new key in place would leave the old
           *   registration under a state record that no longer names it. ⛔ A move onto an entry
           *   that is already registered fails the plan (rename-identity.ts).
           */
          const move = yield* judgeRename(IDENTITY, olds, news, output);
          if (output === undefined) return yield* noteResume(instanceId);
          if (move !== undefined) return { action: 'replace' } as const;
          if (!isResolved(news)) return undefined;
          const form = resolve(news);
          const found = yield* readEntry(form);
          if (found === undefined) return { action: 'update' } as const;
          return matches(found.attributes, form)
            ? ({ action: 'noop' } as const)
            : ({ action: 'update' } as const);
        }),

        /** The refusals — declarative, builtin, self-reported version — live in plugin-reconcile.ts. */
        reconcile: Effect.fn(function* ({ fqn, instanceId, news, output }) {
          // ⛔ An `update` across a move the diff could not see — refused before any write.
          yield* guardRename(IDENTITY, news, output);
          return yield* reconcilePlugin(news, claimFor({ fqn, instanceId, output }));
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
