/**
 * Bao.Plugin's read and reconcile, as plain effects — split from plugin.ts so the refusals below can
 * be run against a fake server rather than only reasoned about.
 */
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import type { Claim } from '../ownership/adopt.ts';
import type { BaoError } from './bao-status.ts';
import {
  type BaoPluginAttributes,
  type BaoPluginForm,
  type BaoPluginProps,
  attributesOf,
  matches,
  problems,
  resolve,
  versionedPath,
} from './plugin-form.ts';
import { readPluginData, registerPlugin } from './plugin-wire.ts';

type Entry = { readonly attributes: BaoPluginAttributes; readonly live: Record<string, unknown> };

/** Live entry, plus the raw body — reconcile needs the raw half for `oci` and `declarative`. */
export const readEntry = (
  form: BaoPluginForm,
): Effect.Effect<Entry | undefined, BaoError, HttpClient.HttpClient> =>
  Effect.map(readPluginData(form), (live) =>
    live === undefined ? undefined : { attributes: attributesOf(form, live), live },
  );

const refuse = (form: BaoPluginForm, message: string) =>
  Effect.die(
    new Error(`Bao.Plugin ${versionedPath(form.type, form.name, form.version)}: ${message}`),
  );

/**
 * ⚠️ AN UNVERSIONED REGISTRATION OF A BINARY THAT REPORTS ITS OWN VERSION IS FILED UNDER THAT
 *   VERSION. setInternal (plugin_catalog.go:1222-1228) takes the self-reported version when the
 *   request names none, and the storage key carries it — so the unversioned read that follows finds
 *   nothing, or finds an OLDER genuinely-unversioned entry. The Cloudflare engine reports one
 *   (`framework.Backend.RunningVersion`). REASONED FROM SOURCE, not measured against a server.
 * ⚠️ THE WRITE HAS ALREADY LANDED when this fires, so the catalog holds a registration no state
 *   record names. Declaring the reported version and deploying once with `--adopt` adopts it (same
 *   sha256 and command, so reconcile matches and writes nothing); declaring a DIFFERENT version is
 *   refused by the server itself (setInternal :1219-1221, "plugin version mismatch").
 * ⚠️ `--adopt`, NOT A SILENT RESUME (2026-09-21): the row this create left names the UNVERSIONED
 *   entry, so it cannot prove the versioned one ours (docs/ownership.md).
 */
const SELF_REPORTED =
  'the write succeeded but the read-back does not match. If the binary reports its own version, ' +
  'OpenBao filed the registration under it (plugin_catalog.go setInternal) — declare `version` ' +
  'as exactly the version the binary reports, and deploy once with --adopt: that adopts the ' +
  'entry this write just made.';

/**
 * Register when the live entry differs, then prove it by reading back. Dies on a refusal.
 * ⛔ `claim` (the provider passes it): a create never takes over an entry already registered.
 */
export const reconcilePlugin = (
  props: BaoPluginProps,
  claim?: Claim,
): Effect.Effect<BaoPluginAttributes, BaoError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const form = resolve(props);
    const bad = problems(form);
    if (bad.length > 0) return yield* refuse(form, bad.join('; '));

    const found = yield* readEntry(form);
    if (found !== undefined && claim !== undefined) {
      yield* claim(`Bao.Plugin ${versionedPath(form.type, form.name, form.version)}`);
    }
    if (found !== undefined && !matches(found.attributes, form)) {
      /**
       * ⛔ A DECLARATIVE OR OCI ENTRY BELONGS TO THE SERVER'S CONFIG FILE (`plugin` stanzas with
       *   plugin_auto_register), which re-registers it on every plugin reload. An API write turns
       *   it non-declarative, and the next reload then REFUSES the config entry: "conflicts with
       *   existing non-declarative plugin" (plugin_catalog.go:333-336).
       */
      if (found.live['declarative'] === true || found.live['oci'] === true) {
        return yield* refuse(
          form,
          'the live entry is declarative/OCI; manage it in server config.',
        );
      }
      /**
       * ⛔ AN UNVERSIONED WRITE OVER A BUILTIN SHADOWS IT FOR EVERY MOUNT OF THAT TYPE. The catalog
       *   answered with OpenBao's own builtin (`builtin: true`), and get() returns an external entry
       *   before it ever looks at builtins (plugin_catalog.go:982-1036). Register a versioned plugin
       *   instead, which leaves the builtin where it is.
       */
      if (found.attributes.builtin) {
        return yield* refuse(form, 'this name is a builtin; an unversioned write would shadow it.');
      }
    }
    if (found === undefined || !matches(found.attributes, form)) yield* registerPlugin(form);

    // ⚠️ RE-READ AND COMPARE, never echo the declaration — see SELF_REPORTED above.
    const after = yield* readEntry(form);
    if (after === undefined || !matches(after.attributes, form)) {
      return yield* refuse(form, SELF_REPORTED);
    }
    return after.attributes;
  });
