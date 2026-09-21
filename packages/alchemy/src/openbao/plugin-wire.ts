/**
 * The OpenBao calls Bao.Plugin makes — read one catalog entry, register, deregister. Split from
 * plugin.ts so the calls can be pinned against a fake server, the way mount-wire.ts is.
 *
 * ★ ENDPOINTS, READ FROM openbao v2.6.2 api/sys_plugins.go (the client `bao plugin` uses) and the
 *   handlers in vault/logical_system.go:
 *     read        GET    sys/plugins/catalog/<type>/<name>[?version=]  (GetPlugin, :159-183)
 *     register    PUT    sys/plugins/catalog/<type>/<name>             (RegisterPlugin, :212-228)
 *     deregister  DELETE sys/plugins/catalog/<type>/<name>[?version=]  (DeregisterPlugin, :249-261)
 *   (api/sys_plugins.go diffed identical between v2.6.0 and v2.6.2.)
 * ⚠️ ALL THREE NEED `sudo` ON THE PATH, not just the verb (docs/api/system/plugins-catalog.mdx). A
 *   token without it reads as 403, which is an error here, never "absent".
 */
import type * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { baoDelete, baoRead, baoWrite } from './bao-http.ts';
import type { BaoError } from './bao-status.ts';
import {
  type BaoPluginForm,
  type BaoPluginType,
  catalogPath,
  registerBody,
  versionedPath,
} from './plugin-form.ts';

/**
 * One catalog entry, or undefined when the catalog has none at that name, type and version.
 *
 * ★ UNLIKE A MOUNT, A MISSING PLUGIN REALLY IS A 404. handlePluginCatalogRead returns `nil, nil` when
 *   the catalog lookup finds nothing (vault/logical_system.go:545-547), and RespondErrorCommon turns
 *   a nil READ response into 404 (sdk v2.6.2 logical/response_util.go:23-26). No second question is
 *   needed, unlike the mount-table check in mount-wire.ts.
 * ⚠️ A BUILTIN ANSWERS TOO. With no external registration at an unversioned name, the catalog falls
 *   through to OpenBao's own builtin of that name and type (plugin_catalog.go get, :1016-1036), which
 *   reads back with `builtin: true` — present, but not a registration. plugin.ts decides what that
 *   means.
 */
export const readPluginData = (
  form: BaoPluginForm,
): Effect.Effect<Record<string, unknown> | undefined, BaoError, HttpClient.HttpClient> =>
  baoRead(versionedPath(form.type, form.name, form.version));

export const registerPlugin = (
  form: BaoPluginForm,
): Effect.Effect<void, BaoError, HttpClient.HttpClient> =>
  baoWrite('PUT', catalogPath(form.type, form.name), registerBody(form));

/**
 * ★ IDEMPOTENT ON THE SERVER. deleteInternal deletes the storage key whether or not it exists
 *   (plugin_catalog.go:1272-1284) and the handler answers with no body, so a retried delete succeeds.
 * ⛔ AND THAT IS THE DANGER: NOTHING CHECKS WHETHER A MOUNT STILL USES THE PLUGIN. The same function
 *   has no mount lookup at all, so deregistering the plugin a live mount runs succeeds. The running
 *   process is not killed by it; the mount breaks the next time OpenBao has to START the plugin — a
 *   reload, a restart, an unseal — long after the plan that did it. REASONED FROM SOURCE, not run.
 */
export const deregisterPlugin = (
  type: BaoPluginType,
  name: string,
  version: string,
): Effect.Effect<void, BaoError, HttpClient.HttpClient> =>
  baoDelete(versionedPath(type, name, version));
