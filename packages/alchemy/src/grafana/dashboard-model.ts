/**
 * Pure functions over a dashboard JSON model — no SDK call, no Effect. Split out of dashboard.ts
 * so that file stays under the house's 250-line cap, and so `normalizeModel`'s no-change-is-noop
 * behavior is exercised directly in dashboard-model.test.ts without a fake Grafana in the way.
 */
export type DashboardModel = Record<string, unknown>;

/** Grafana injects or increments these on every save; a declared model never sets them meaningfully. */
const VOLATILE_FIELDS = ['id', 'version', 'iteration'] as const;

/**
 * ★ NORMALIZES BOTH SIDES THE SAME WAY, so a no-change plan is a true noop
 *   (docs/grafana-folder-dashboard.md). Strips `id`/`version`/`iteration` (Grafana-managed, never
 *   declared content) and forces `uid` to this resource's OWN canonical value, wherever — or
 *   whether — the source object carried one. That second part is "uid placement": a dashboard
 *   pasted from Grafana's own "Export as JSON" always embeds the OLD live uid (or none, for a
 *   never-saved dashboard), while the live model this resource reads back always carries the
 *   CURRENT one; forcing both to `props.uid` before comparing is what makes those two shapes equal
 *   instead of permanently disagreeing on one field neither side is meant to declare independently
 *   (`DashboardProps.uid` — see dashboard.ts — is the single source of truth).
 *
 * ⚠️ EVERY OTHER DECLARED FIELD COMPARES STRUCTURALLY, ARRAY ORDER INCLUDED — dashboard.ts's
 *   `matches` runs this output through THIS FILE's own `declaredContentMatches` (below), which
 *   never reorders an array. That is correct here: `panels` is position-significant (screen layout
 *   via its own `gridPos`, but the array order also drives Grafana's internal panel indexing and
 *   any `repeat` behavior) and each panel's `targets` is execution/legend order. Nothing in a
 *   dashboard model is a genuinely unordered SET the way UniFi's `trustedDhcpServerIpAddresses` is
 *   (unifi/network-form.ts's `sortedSet`) — this family has no field that needs one.
 * ⚠️ `schemaVersion` IS DELIBERATELY **NOT** NORMALIZED — NOT MEASURED against a live instance (no
 *   live calls in this PR). Community reports say Grafana can rewrite an old dashboard's
 *   `schemaVersion` upward on load; IF that also happens on every plain save of an
 *   already-current-schema dashboard, every plan against it would show a false `update` forever —
 *   but silently normalizing it away on a guess would just as easily hide a genuine schema
 *   mismatch. Left comparing until measured: add it to `VOLATILE_FIELDS` with a dated, measured
 *   comment the day it is seen live, the same standard every other row in this file meets.
 */
export const normalizeModel = (model: DashboardModel, uid: string): DashboardModel => {
  const normalized: DashboardModel = {};
  for (const [key, value] of Object.entries(model)) {
    if (key === 'uid') continue;
    if ((VOLATILE_FIELDS as readonly string[]).includes(key)) continue;
    normalized[key] = value;
  }
  normalized.uid = uid;
  return normalized;
};

/** The model's own declared title — reporting only. It is never compared on its own; the whole
 *  normalized model is, in dashboard.ts's `matches`, so a title-only mismatch still shows `update`. */
export const modelTitle = (model: DashboardModel): string =>
  typeof model.title === 'string' ? model.title : '';

/**
 * `declared` need only be a subset of `live` — dashboard.ts's `matches` runs `normalizeModel`'s
 * output through this. Moved to `subset-match.ts` once `Grafana.ContactPoint`'s `settings` needed
 * the identical "declaration silent about a field means don't compare it" rule; re-exported here
 * under its original name so this file's own callers and dashboard-model.test.ts are unchanged.
 * See subset-match.ts for the full reasoning, including the regression this exists to fix
 * (Grafana's dashboard-save schema migration auto-decorating a panel's `datasource`) and the
 * trade-off it accepts (an omitted field can no longer force-clear a previously-set one).
 */
export { declaredContentMatches } from './subset-match.ts';
