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

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * ★ `declared` NEED ONLY BE A SUBSET OF `live` — an adversarial review of this PR (2026-09-24)
 *   found that plain structural equality made an ordinary, never-edited dashboard show `update`
 *   FOREVER: Grafana's own dashboard-save schema migration rewrites any panel or target whose
 *   `datasource` is absent into an explicit `{type, uid}` reference to the resolved default
 *   datasource — documented Grafana schema-migration behavior (not re-measured against a live
 *   instance in this PR — no live calls). A declared panel that never sets `datasource` (the
 *   common case: hand-authored JSON, or anything relying on the dashboard-level default) would,
 *   after the FIRST create, read back with that field populated; plain `deepEqual` (this file used
 *   `alchemy/Diff`'s before this fix) then disagreed with the declaration on every subsequent plan,
 *   `update` sent the undecorated model back, and Grafana redecorated it again on the next read —
 *   non-convergent.
 *
 * This function instead asks only "does every field the DECLARATION mentions, at any depth, still
 * match what is live" — `live` may carry additional fields, at any depth, that `declared` never
 * mentioned (the datasource auto-decoration above, or any future Grafana-injected default,
 * `fieldConfig` defaults and `pluginVersion` included) without being compared at all. A field
 * `declared` DOES mention that is missing, or different, in `live` still fails the match — real
 * content drift is still caught exactly as before; only fields the declaration is silent about are
 * now tolerated rather than compared.
 *
 * ⚠️ THE TRADE-OFF THIS ACCEPTS, DELIBERATELY: removing a field from the declaration (rather than
 *   changing its value) can no longer force Grafana to drop it. If a panel once declared an
 *   explicit `datasource` and a later declaration deletes that key entirely (rather than setting a
 *   different one), `live` keeps whatever the last write set — the declaration is silent about that
 *   key now, so nothing compares it, so no `update` ever fires to change it. This is the same
 *   "undeclared means don't care, never means force-to-default" convention already used everywhere
 *   else in this kit for a plain optional prop (e.g. `datasource.ts`'s `matches` never treats an
 *   undeclared `access` as "must be unset"); it now also applies inside the JSON model, not just at
 *   the props level. Declare an explicit replacement value to change a field; omission never clears
 *   one that was set by a previous declaration or by Grafana itself.
 *
 * ⚠️ ARRAYS COMPARE BY LENGTH, THEN ELEMENT-WISE SUBSET — never by a looser "declared has fewer
 *   items" rule. `panels`/`targets` are position-significant (see `normalizeModel`'s header); an
 *   array Grafana pads or reorders on its own would still need normalizing here explicitly, the
 *   same as any other newly-discovered auto-decoration — this function does not paper over that.
 * ⚠️ `null` ON EITHER SIDE OF A LEAF NEVER MISMATCHES (mirrors `alchemy/Diff`'s `deepEqual` with
 *   `stripNullish: true`, which this function replaces for the dashboard model specifically).
 */
export const declaredContentMatches = (declared: unknown, live: unknown): boolean => {
  if (declared == null) return true;
  if (Array.isArray(declared)) {
    return (
      Array.isArray(live) &&
      declared.length === live.length &&
      declared.every((item, index) => declaredContentMatches(item, live[index]))
    );
  }
  if (isPlainObject(declared)) {
    return (
      isPlainObject(live) &&
      Object.entries(declared).every(([key, value]) => declaredContentMatches(value, live[key]))
    );
  }
  return declared === live;
};
