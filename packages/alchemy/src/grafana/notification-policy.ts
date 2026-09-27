/**
 * `Grafana.NotificationPolicy` — the notification policy tree. A SINGLETON: `GET`/`PUT`
 * `/v1/provisioning/policies` always address the ONE tree an instance has, there is no path
 * parameter, and `RouteGetPolicyTreeError` is `Forbidden | GrafanaOpError` — no `NotFound` case at
 * all, MEASURED. `fetchLive` therefore NEVER returns `undefined`: this resource has no create and
 * no delete in the sense every other resource in this family does — `reconcile`'s `before ===
 * undefined` branch (`resource.ts`) is dead code here, and `create` below exists only because
 * `GrafanaSpec.create` is a required field on the shared type, not because it is ever reached.
 * "Declaring" this resource means ADOPTING whatever tree is live and then keeping it in sync —
 * never creating or destroying the tree itself, only ever `PUT`-replacing its contents.
 *
 * ⛔ `routeResetPolicyTree` IS NEVER CALLED UNLESS `allowReset: true` IS EXPLICITLY DECLARED — a
 *   second, independent gate on top of `defaultRemovalPolicy: 'retain'` below. Alchemy's own
 *   removal-policy gate decides whether the engine calls this resource's `delete` handler AT ALL
 *   (retain means it never does, unless a stack opts in with `.pipe(RemovalPolicy.destroy())` —
 *   the convention every `Bao.*`/`Grafana.Folder`/`Grafana.AlertRuleGroup` family member already
 *   uses); `allowReset` is a SEPARATE prop-level gate inside `destroy` itself, so even a stack that
 *   opted into destroy at the Alchemy level still needs this resource's own explicit opt-in before
 *   it will reset. Two gates, not one, because `routeResetPolicyTree` is uniquely destructive among
 *   everything this family calls: it wipes every declared route, receiver reference and matcher
 *   back to Grafana's own bare default in one call, for the WHOLE instance, not one object. Without
 *   `allowReset`, `destroy` logs a warning and returns — retained, not reset.
 *
 * ★ PUT REPLACES THE WHOLE TREE — A DROPPED SUB-ROUTE IS WARNED ABOUT, NEVER SILENT. Same shape as
 *   kit PR 254's `Grafana.AlertRuleGroup` fix (an adversarial review of that PR found the identical
 *   risk for rule groups): `notification-policy-drop-warning.ts`'s `warnOnDroppedRoutes`, called
 *   from both this resource's custom `diff` (so `bun run plan` shows it before anything is
 *   written) and from `update` itself.
 *
 * ⛔ ROUTE ORDER IS SIGNIFICANT — NEVER REORDERED. Same as `Grafana.AlertRuleGroup`'s rules:
 *   `subset-match.ts`'s array comparison is position-significant, and Alertmanager itself routes
 *   an alert to the FIRST matching route in array order — reordering routes is a genuine routing
 *   change, not cosmetic.
 *
 * ⛔ A FOREIGN-PROVENANCE TREE REFUSES EVERY UPDATE — `alerting-provenance.ts`, unchanged from kit
 *   PR 250/254 (including the missing-means-foreign fix: `Route.provenance` is optional on the
 *   wire, and `undefined` is never folded into `""`). `create` is never at risk — see above, it is
 *   unreachable.
 *
 * ⚠️ GRAFANA-INJECTED DEFAULTS ARE TOLERATED THE `declaredContentMatches` WAY, NOT HAND-NORMALIZED
 *   — `matches()` below runs the (volatile-field-stripped) declared and live trees through
 *   `subset-match.ts`'s tolerant-subset comparison, the same mechanism `Grafana.Dashboard`'s
 *   panel-`datasource` auto-decoration and `Grafana.ContactPoint`'s settings defaults already rely
 *   on: a live tree may carry additional fields, at any depth, the declaration never mentioned
 *   (Grafana injecting a default `group_wait`/`group_interval`/`repeat_interval`/`group_by: []`
 *   when the declaration omits them is the plausible case) without failing the match. ⚠️ NOT
 *   MEASURED against a live instance — no live policy tree exists in this house to read (no live
 *   calls in this PR either) — this is the documented, conservative default every unmeasured value
 *   shape in this family takes, not a guess dressed up as a fact.
 *
 * ⚠️ `X-Disable-Provenance` IS NEVER SET — same reasoning as `contact-point.ts`'s file header.
 */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as grafana from '@distilled.cloud/grafana';
import * as Effect from 'effect/Effect';
import {
  type GrafanaProvisionedObjectError,
  isForeignProvenance,
  refuseIfForeignProvenance,
} from './alerting-provenance.ts';
import { type PolicyRoute, normalizeRoute } from './notification-policy-model.ts';
import { warnOnDroppedRoutes } from './notification-policy-drop-warning.ts';
import { type GrafanaSpec, grafanaHandlers } from './resource.ts';
import { declaredContentMatches } from './subset-match.ts';

export type { PolicyRoute };

export interface NotificationPolicyProps {
  /** The root route and its full nested tree — Grafana's `Route` shape (`receiver`, `group_by`,
   *  `matchers`, nested `routes[]`, …), passed through opaquely — see the file header. Order of
   *  `routes[]` at every level is significant. */
  route: PolicyRoute;
  /** Lets `destroy` actually call `routeResetPolicyTree`. Defaults to `false` — see the file
   *  header for why this is a second gate on top of Alchemy's own removal policy. */
  allowReset?: boolean;
}

export interface NotificationPolicyAttributes {
  route: PolicyRoute;
  /** `""`/`"api"` (this family may write); anything else, INCLUDING `undefined`, refuses — see
   *  alerting-provenance.ts's "fails open" note. */
  provenance: string | undefined;
}

export interface GrafanaNotificationPolicy extends Resource<
  'Grafana.NotificationPolicy',
  NotificationPolicyProps,
  NotificationPolicyAttributes,
  never
> {}

export const GrafanaNotificationPolicy = Resource<GrafanaNotificationPolicy>(
  'Grafana.NotificationPolicy',
  { defaultRemovalPolicy: 'retain' },
);

const body = (props: NotificationPolicyProps) =>
  props.route as unknown as grafana.RoutePutPolicyTreeRequest;

export const spec: GrafanaSpec<
  NotificationPolicyProps,
  grafana.Route,
  NotificationPolicyAttributes,
  | grafana.RouteGetPolicyTreeError
  | grafana.RoutePutPolicyTreeError
  | grafana.RouteResetPolicyTreeError
  | GrafanaProvisionedObjectError
> = {
  attributes: (live) => ({
    provenance: live.provenance,
    route: normalizeRoute(live as unknown as PolicyRoute),
  }),
  // ⚠️ UNREACHABLE IN PRACTICE — see the file header. Implemented as the same PUT `update` sends,
  //   defensively, rather than `Effect.die`, in case a future Grafana version ever does answer
  //   `NotFound` here; `GrafanaSpec.create` is required by the shared type either way.
  create: (props) => grafana.routePutPolicyTree(body(props)),
  destroy: (props, live) =>
    Effect.gen(function* () {
      if (isForeignProvenance(live.provenance)) {
        return yield* refuseIfForeignProvenance(
          'Grafana.NotificationPolicy',
          'default',
          live.provenance,
        );
      }
      if (props.allowReset !== true) {
        yield* Effect.logWarning(
          'Grafana.NotificationPolicy: destroy requested but allowReset is not set -- the policy ' +
            'tree is RETAINED, not reset. Grafana always needs a root route; resetting wipes ' +
            "every declared route/receiver/matcher back to Grafana's own default for the WHOLE " +
            'instance. Set allowReset: true to actually call routeResetPolicyTree.',
        );
        return;
      }
      yield* grafana.routeResetPolicyTree({});
    }),
  fetchLive: (_props) => grafana.routeGetPolicyTree({}),
  matches: (attributes, props) =>
    declaredContentMatches(normalizeRoute(props.route), attributes.route),
  update: (props, live) =>
    Effect.gen(function* () {
      if (isForeignProvenance(live.provenance)) {
        return yield* refuseIfForeignProvenance(
          'Grafana.NotificationPolicy',
          'default',
          live.provenance,
        );
      }
      yield* warnOnDroppedRoutes(props.route, live as unknown as PolicyRoute);
      yield* grafana.routePutPolicyTree(body(props));
    }),
};

/**
 * ⚠️ A LOCAL REIMPLEMENTATION OF `resource.ts`'s GENERIC `diff`, NOT A WRAP OF IT — same reasoning
 *   as `alert-rule-group.ts`'s own `diff`: the generic version has no seam to run the drop-warning
 *   side effect against the live tree it reads, and wrapping it would mean a second live fetch
 *   just to see what it already saw.
 */
const diff = ({
  news,
  output,
}: {
  news: Input<NotificationPolicyProps>;
  output: NotificationPolicyAttributes | undefined;
}) =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    const live = yield* spec.fetchLive(news);
    // ⚠️ UNREACHABLE IN PRACTICE — see the file header: `routeGetPolicyTree` has no `NotFound`
    //   case, so `live` is never actually `undefined`. `GrafanaSpec.fetchLive`'s shared return
    //   type is `Live | undefined` for every resource in the family, so this check exists purely
    //   to satisfy that type, the same defensive stance `create` above takes.
    if (live === undefined) return { action: 'update' } as const;
    yield* warnOnDroppedRoutes(news.route, live as unknown as PolicyRoute);
    const mapped = spec.attributes(live, news);
    return mapped !== undefined && spec.matches(mapped, news)
      ? ({ action: 'noop' } as const)
      : ({ action: 'update' } as const);
  });

export const handlers = { ...grafanaHandlers(spec), diff };

export const GrafanaNotificationPolicyProvider = () =>
  Provider.effect(
    GrafanaNotificationPolicy,
    Effect.succeed(GrafanaNotificationPolicy.Provider.of(handlers)),
  );
