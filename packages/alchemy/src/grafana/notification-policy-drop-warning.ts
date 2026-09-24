/**
 * The warning `Grafana.NotificationPolicy` logs when a whole-tree `PUT` would silently drop a live
 * sub-route the declaration doesn't account for — same shape as `alert-rule-group-drop-warning.ts`
 * (kit PR 254's own fix, after an adversarial review found the identical risk for rule groups):
 * `PUT /v1/provisioning/policies` REPLACES the entire tree, so a nested route someone added
 * out-of-band is removed with no error and no distinct `Diff` action to report it under.
 *
 * ★ `Effect.logWarning`, NEVER A REFUSAL — same reasoning as `alert-rule-group-drop-warning.ts`'s
 *   own header, and further upstream `proxmox/unreadable-read.ts`'s `unreadableWarning`. A
 *   whole-tree write dropping an out-of-band route is EXPECTED for a resource whose whole point is
 *   to own the tree — only a silent one is worth surfacing loudly.
 *
 * ⛔ MULTISET COMPARISON, NOT SET MEMBERSHIP — fixed after an adversarial review of this PR found
 *   the first version's `Set`-based check collided ACROSS THE WHOLE TREE: any two nodes anywhere
 *   with identical own-fields shared one `Set` entry, so a duplicate route added out-of-band
 *   (e.g. a second `severity=warning -> slack` alongside an already-declared one) matched the
 *   existing entry and went unwarned even though the PUT would still drop it — worse than the
 *   documented "siblings only" limitation the original comment claimed. Every key from
 *   `FlatRoute.key` (ancestry-scoped — see that field's own doc) is now counted per side, and a
 *   `key` is only "dropped" for the amount its LIVE count exceeds its DECLARED count — N identical
 *   live occurrences under the same parent are dropped only past however many the declaration
 *   itself repeats, never all of them at once just because one is declared.
 */
import * as Effect from 'effect/Effect';
import { type PolicyRoute, flattenRoutes, normalizeRoute } from './notification-policy-model.ts';

const countByKey = (routes: ReadonlyArray<{ readonly key: string }>): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const route of routes) counts.set(route.key, (counts.get(route.key) ?? 0) + 1);
  return counts;
};

export const warnOnDroppedRoutes = (
  declared: PolicyRoute,
  live: PolicyRoute,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    // Root is never "dropped" — it is always replaced, not removed (the file header's own note).
    const declaredNodes = flattenRoutes(normalizeRoute(declared)).filter((r) => r.path !== 'root');
    const liveNodes = flattenRoutes(normalizeRoute(live)).filter((r) => r.path !== 'root');
    const declaredCounts = countByKey(declaredNodes);
    const liveCounts = countByKey(liveNodes);

    const dropped: Array<{ readonly path: string; readonly receiver: string }> = [];
    for (const [key, liveCount] of liveCounts) {
      const extra = liveCount - (declaredCounts.get(key) ?? 0);
      if (extra <= 0) continue;
      // Report the LAST `extra` live occurrences of this key, by path — an arbitrary but
      // deterministic choice among indistinguishable duplicates (multiset identity, no position).
      const occurrences = liveNodes.filter((route) => route.key === key);
      dropped.push(...occurrences.slice(-extra));
    }
    if (dropped.length === 0) return;
    const names = dropped.map((route) => `${route.receiver} (${route.path})`).join(', ');
    yield* Effect.logWarning(
      `Grafana.NotificationPolicy: this update REMOVES ${dropped.length} route(s)/matcher(s) not ` +
        `in the declaration: ${names}. Whole-tree replacement is by design — add them to the ` +
        `declared tree to keep them.`,
    );
  });
