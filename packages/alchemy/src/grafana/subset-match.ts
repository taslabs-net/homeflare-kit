/**
 * `declaredContentMatches` — "is the declaration a subset of what is live", not plain equality.
 * Extracted out of `dashboard-model.ts` (where it was introduced, after an adversarial review of
 * that PR found plain structural equality made an ordinary, never-edited dashboard show `update`
 * FOREVER) once a second shape needed the identical rule: `Grafana.ContactPoint`'s `settings` is
 * the same story — Grafana can inject default fields into a contact point's settings that the
 * declaration never mentioned, and `Grafana.AlertRuleGroup`'s per-rule `data`/`annotations`/
 * `labels` maps carry the same risk. Nothing about the reasoning below is dashboard-specific;
 * `dashboard-model.ts` now just re-exports this.
 *
 * ★ `declared` NEED ONLY BE A SUBSET OF `live`. Grafana's own save/decode path can decorate an
 *   object with fields the declaration never set (a dashboard panel's auto-resolved `datasource`
 *   reference is the documented example dashboard-model.ts found — Grafana's schema migration
 *   decorates any panel/target whose `datasource` is absent with an explicit `{type, uid}`
 *   reference on save). This function instead asks only "does every field the DECLARATION
 *   mentions, at any depth, still match what is live" — `live` may carry additional fields, at any
 *   depth, that `declared` never mentioned, without being compared at all. A field `declared` DOES
 *   mention that is missing, or different, in `live` still fails the match — real content drift is
 *   still caught exactly as before; only fields the declaration is silent about are now tolerated.
 *
 * ⚠️ THE TRADE-OFF THIS ACCEPTS, DELIBERATELY: removing a field from the declaration (rather than
 *   changing its value) can no longer force Grafana to drop it. If a previous declaration set a
 *   field and a later one deletes that key entirely, `live` keeps whatever the last write set — the
 *   declaration is silent about that key now, so nothing compares it, so no `update` ever fires to
 *   change it. This is the same "undeclared means don't care, never means force-to-default"
 *   convention already used everywhere else in this kit for a plain optional prop; it now also
 *   applies inside a nested JSON value, not just at the top-level props. Declare an explicit
 *   replacement value to change a field; omission never clears one that was set by a previous
 *   declaration or by Grafana itself.
 *
 * ⚠️ ARRAYS COMPARE BY LENGTH, THEN ELEMENT-WISE SUBSET — never a looser "declared has fewer
 *   items" rule. A caller whose array IS order-significant (dashboard `panels`/`targets`) or
 *   position-keyed (an alert rule group's `rules`) gets that for free; a caller with a genuinely
 *   unordered array would need its own normalization first (this file has no `sortedSet`, and
 *   nothing in this kit's Grafana family needs one — see dashboard-model.ts's own note).
 *
 *   ⛔ NOT RE-MEASURED FOR EVERY CALLER — flagged by an adversarial review of this PR. The exact
 *   length rule is confirmed for dashboards (the original, documented case), but whether Grafana
 *   ever PADS or APPENDS a default entry to an array the way it decorates an object field (the
 *   `datasource` auto-decoration above) is unverified for `Grafana.MuteTiming`'s `time_intervals`
 *   specifically — no live mute timing exists in this house to observe (grafana.md's census), and
 *   `mute-timing.test.ts`'s own fixtures are hand-authored, not captured. If a future live
 *   observation finds Grafana appending an entry (e.g. a normalized default time range) to a
 *   declared `time_intervals` array, the length check here would show a permanent false `update` —
 *   the exact regression this whole file exists to prevent for OBJECT fields already. `mute-timing.
 *   test.ts`'s "array length is exact, not tolerant" test pins today's behavior so that fix has an
 *   obvious, single place to change (relax this rule, or give the mute-timing caller its own
 *   length-tolerant wrapper) rather than being rediscovered from scratch.
 * ⚠️ `null` ON EITHER SIDE OF A LEAF NEVER MISMATCHES (mirrors `alchemy/Diff`'s `deepEqual` with
 *   `stripNullish: true`, which this function replaces wherever a caller needs subset semantics).
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
