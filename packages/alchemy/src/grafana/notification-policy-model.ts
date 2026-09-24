/**
 * Pure functions over the notification policy tree — no SDK call, no Effect. Split out of
 * `notification-policy.ts` the same way `dashboard-model.ts`/`alert-rule-group-model.ts` are split
 * out of their resources.
 *
 * ★ THE TREE IS OPAQUE `Record<string, unknown>`, NOT THE SDK's OWN `Route` TYPE — same reasoning
 *   as `mute-timing.ts`'s `timeIntervals`: Grafana's `Matchers`/`ObjectMatchers`/`MatchRegexps`
 *   (matcher expression shapes) are complex nested union/array types this family does not attempt
 *   to model field-by-field. `routePutPolicyTree`'s request body encodes/decodes any key
 *   verbatim regardless (the same unmodeled-key passthrough `mute-timing.ts`'s file header
 *   documents for this SDK generally), so an opaque pass-through both round-trips correctly and
 *   stays usable for every matcher/route shape Grafana accepts, not just the ones this file would
 *   otherwise hand-model.
 */
export type PolicyRoute = Record<string, unknown>;

/** Grafana-managed, never declared content. MEASURED against `Route` (services/grafana.ts):
 *  `provenance` is the only field on this type that is unambiguously read-only (every other field
 *  — `receiver`, `group_by`, `matchers`, `routes`, … — is exactly what a declaration sets). An
 *  object this family just wrote reads back with `provenance: "api"`, which the declaration never
 *  sets, so comparing it would show a false `update` forever — the same reasoning
 *  `alert-rule-group-model.ts`'s own `RULE_VOLATILE_FIELDS` note gives for a rule's `provenance`.
 *  Stripped RECURSIVELY: `Route.routes` is `Array<Route>`, so a nested route could in principle
 *  carry its own `provenance` too — not measured live (no live policy tree in this house to read),
 *  but stripping it everywhere is the conservative reading, the same one `provisioned.ts`'s
 *  `managedBy` note takes for an unmeasured value shape. */
const ROUTE_VOLATILE_FIELDS = ['provenance'] as const;

export const normalizeRoute = (route: PolicyRoute): PolicyRoute => {
  const out: PolicyRoute = {};
  for (const [key, value] of Object.entries(route)) {
    if ((ROUTE_VOLATILE_FIELDS as readonly string[]).includes(key)) continue;
    if (key === 'routes' && Array.isArray(value)) {
      out.routes = value.map((child) => normalizeRoute(child as PolicyRoute));
      continue;
    }
    out[key] = value;
  }
  return out;
};

export interface FlatRoute {
  /** Dotted child-index path from the root, e.g. `root.0.1` — WHERE this occurrence sits, for the
   *  warning message only; never part of `key`. */
  readonly path: string;
  readonly receiver: string;
  /**
   * Identity for the dropped-route warning — MEASURED FIX (an adversarial review of this PR found
   * the first version's identity, plain per-node JSON in a `Set`, collided across the WHOLE TREE:
   * a duplicate route added anywhere, not just as a live-only sibling, silently matched an
   * unrelated declared node with the same fields and the drop went unwarned). `key` is now the
   * chain of ancestor own-fields from the root down to this node (this node's own fields included,
   * `routes` children excluded at every level, `\0`-joined — a byte no route's own JSON can
   * contain): two nodes are "the same" only if they sit under the identical lineage of ancestors,
   * which makes an identical route under a DIFFERENT parent correctly distinct, while still being
   * ORDER-INSENSITIVE among siblings (a shared parent contributes the same ancestor key to every
   * child regardless of index) — a plain reorder is never reported as a drop.
   * `notification-policy-drop-warning.ts` counts occurrences of each `key` as a MULTISET (declared
   * count vs. live count), not set membership, so N live duplicates of the same node under the
   * same parent are only "dropped" past however many the declaration itself repeats.
   */
  readonly key: string;
}

const ownFieldsJson = (route: PolicyRoute): string => {
  const { routes: _routes, ...ownFields } = route;
  return JSON.stringify(ownFields);
};

/**
 * Depth-first flatten of a (already-normalized) route tree, `root` itself included at `path:
 * 'root'` and `key` equal to its own fields alone (no ancestor to chain from). Used only by
 * `notification-policy-drop-warning.ts`'s best-effort "what did this write remove" detection —
 * `matches()` in `notification-policy.ts` never uses this, only `declaredContentMatches` on the
 * tree as a whole, so nothing about drift DETECTION depends on it.
 *
 * ⚠️ STILL A BEST-EFFORT KEY, NOT A STABLE ONE — Grafana's policy routes have no id/uid the way
 *  every other object in this family does; `key` is a measured, deliberate improvement over plain
 *  per-node identity (see `FlatRoute.key`'s own doc), not a claim of a real Grafana-side key. A
 *  false negative here (missing a genuine drop) never hides real drift from `matches()`, which
 *  compares the whole tree structurally regardless of this file.
 */
export const flattenRoutes = (
  route: PolicyRoute,
  path = 'root',
  ancestorKey = '',
): ReadonlyArray<FlatRoute> => {
  const children = Array.isArray(route.routes) ? (route.routes as PolicyRoute[]) : [];
  const ownJson = ownFieldsJson(route);
  const key = ancestorKey === '' ? ownJson : `${ancestorKey}\0${ownJson}`;
  const self: FlatRoute = {
    key,
    path,
    receiver: typeof route.receiver === 'string' ? route.receiver : '(inherited)',
  };
  return [
    self,
    ...children.flatMap((child, index) => flattenRoutes(child, `${path}.${index}`, key)),
  ];
};
