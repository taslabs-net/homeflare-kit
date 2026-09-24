/**
 * `Grafana.ContactPoint` — one Grafana alerting contact point, keyed by `uid`.
 *
 * ⚠️ NO GET-BY-UID ROUTE EXISTS — MEASURED against the SDK's generated operations (grep across
 *   `services/grafana.ts` for `routeGet.*[Cc]ontactpoint`: only `routeGetContactpoints` (list,
 *   with an optional `name` filter) and `routeGetContactpointsExport`). Unlike
 *   `Grafana.Datasource`/`Grafana.Folder`/`Grafana.Dashboard`, `fetchLive` cannot key its read
 *   directly on `uid`. Filtering server-side by `name` is NOT a substitute: `name` is a grouping
 *   label a declaration can rename (`uid` is the only field this resource keys on, and Grafana's
 *   own doc calls `name` "used as grouping key in the UI" — several contact points can share one),
 *   so narrowing the GET to the DECLARED name would miss a live object still filed under an OLDER
 *   name mid-rename, reporting it absent and attempting a duplicate `create`. `fetchLive` instead
 *   lists every contact point (`routeGetContactpoints({})`, no filter) and matches `uid`
 *   client-side — the same ambiguity `resource.ts`'s header and netbox's `soleMatch` name, resolved
 *   the same way: requiring the one field the API is actually keyed on.
 *
 * ⛔ SECRET SETTINGS NEVER APPEAR AS A LITERAL PROP (S25) — same shape as `Grafana.Datasource`'s
 *   `secureJsonDataRefs` (`secret-refs.ts`, shared). Grafana does not use a separate top-level
 *   "secure settings" field for contact points the way it does for datasources; a secure key (a
 *   webhook URL with an embedded token, an API key, …) lives INSIDE `settings` on write, and comes
 *   back inside `settings` REDACTED on read — Grafana's own docs for the contact-points EXPORT
 *   route say as much explicitly ("Redacted settings will contain RedactedValue instead"; the
 *   plain, non-export GET this resource calls has no `decrypt` option at all, so it is redacted
 *   unconditionally). `secureSettingsRefs` therefore names which keys of `settings` are secret —
 *   value resolved from an env var NAME fresh inside `create`/`update`'s own effect (S24), merged
 *   into `settings` only at that point, never stored and never diffed (see `matches` below).
 *
 * ⛔ A FOREIGN-PROVENANCE CONTACT POINT REFUSES EVERY UPDATE AND DESTROY — `alerting-provenance.ts`,
 *   shared with `Grafana.MessageTemplate`/`Grafana.AlertRuleGroup`/`Grafana.NotificationPolicy`.
 *   See that file's header for the full reasoning and citations. `create` is never at risk: it only
 *   runs when `fetchLive` already found nothing with this `uid`.
 *
 * ⚠️ `X-Disable-Provenance` IS NEVER SET, BY DESIGN. Every create/update through this resource
 *   therefore leaves the contact point with `provenance: "api"` (Grafana's own default for an
 *   object this API just wrote) — which the docs describe as blocking that same object from being
 *   edited in the Grafana UI afterward. That is the intended outcome, not an oversight: an object
 *   this family declares is meant to be owned by the declaration, the same "one owner per resource"
 *   posture `provisioned.ts` establishes for folders/dashboards — handing it back to UI-editability
 *   by default would silently create the two-owner situation this whole file exists to prevent.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as grafana from '@distilled.cloud/grafana';
import * as Effect from 'effect/Effect';
import {
  type GrafanaProvisionedObjectError,
  isForeignProvenance,
  refuseIfForeignProvenance,
} from './alerting-provenance.ts';
import { type GrafanaSpec, grafanaHandlers } from './resource.ts';
import { GrafanaSecretRefUnsetError, resolveSecretRefs } from './secret-refs.ts';
import { declaredContentMatches } from './subset-match.ts';

export { GrafanaSecretRefUnsetError };

export interface ContactPointProps {
  uid: string;
  name: string;
  /** Grafana integration id — `slack`, `webhook`, `email`, `pagerduty`, `opsgenie`, … */
  type: string;
  /** Non-secret settings — shape depends on `type`. Never put a secret VALUE here — declare it
   *  in `secureSettingsRefs` instead; see the file header. */
  settings: Record<string, unknown>;
  /** Secure field name (e.g. `url`, `token`, `password`) -> env var NAME holding its value. */
  secureSettingsRefs?: Record<string, string>;
  disableResolveMessage?: boolean;
}

export interface ContactPointAttributes {
  uid: string;
  name: string;
  type: string;
  /** As Grafana returns it — any secure key is a redaction placeholder, never the real value. */
  settings: Record<string, unknown>;
  disableResolveMessage: boolean;
  /** `""`/`"api"` (this family may write); anything else, INCLUDING `undefined` (Grafana didn't
   *  report the field), refuses — see alerting-provenance.ts's "fails open" note. */
  provenance: string | undefined;
}

export interface GrafanaContactPoint extends Resource<
  'Grafana.ContactPoint',
  ContactPointProps,
  ContactPointAttributes,
  never
> {}

export const GrafanaContactPoint = Resource<GrafanaContactPoint>('Grafana.ContactPoint');

/** `settings` minus every key `secureSettingsRefs` names — the only part `matches` ever compares
 *  (a secure key's live value is always a redaction placeholder, never comparable). */
const nonSecretSettings = (props: ContactPointProps): Record<string, unknown> => {
  const refs = props.secureSettingsRefs;
  if (refs === undefined) return props.settings;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props.settings)) {
    if (!(key in refs)) out[key] = value;
  }
  return out;
};

const resolveSettings = (props: ContactPointProps) =>
  Effect.map(
    resolveSecretRefs(props.secureSettingsRefs, (field) => `settings.${field}`),
    (secrets) => (secrets === undefined ? props.settings : { ...props.settings, ...secrets }),
  );

export const spec: GrafanaSpec<
  ContactPointProps,
  grafana.EmbeddedContactPoint,
  ContactPointAttributes,
  | grafana.RouteGetContactpointsError
  | grafana.RoutePostContactpointsError
  | grafana.RoutePutContactpointError
  | grafana.RouteDeleteContactpointsError
  | GrafanaProvisionedObjectError
  | GrafanaSecretRefUnsetError
> = {
  attributes: (live) => ({
    disableResolveMessage: live.disableResolveMessage ?? false,
    name: live.name ?? '',
    // ⛔ NEVER `?? ''` — an absent field must stay distinguishable from an explicit `""`
    //   (ProvenanceNone); see alerting-provenance.ts's "fails open" note.
    provenance: live.provenance,
    settings: (live.settings ?? {}) as Record<string, unknown>,
    type: live.type,
    uid: live.uid ?? '',
  }),
  create: (props) =>
    Effect.flatMap(resolveSettings(props), (settings) =>
      grafana.routePostContactpoints({
        name: props.name,
        settings,
        type: props.type,
        uid: props.uid,
        ...(props.disableResolveMessage === undefined
          ? {}
          : { disableResolveMessage: props.disableResolveMessage }),
      }),
    ),
  destroy: (props, live) =>
    Effect.gen(function* () {
      if (isForeignProvenance(live.provenance)) {
        return yield* refuseIfForeignProvenance('Grafana.ContactPoint', props.uid, live.provenance);
      }
      yield* grafana.routeDeleteContactpoints({ UID: props.uid });
    }),
  fetchLive: (props) =>
    grafana
      .routeGetContactpoints({})
      .pipe(Effect.map((points) => points.find((point) => point.uid === props.uid))),
  matches: (attributes, props) =>
    attributes.name === props.name &&
    attributes.type === props.type &&
    attributes.disableResolveMessage === (props.disableResolveMessage ?? false) &&
    declaredContentMatches(nonSecretSettings(props), attributes.settings),
  update: (props, live) =>
    Effect.gen(function* () {
      if (isForeignProvenance(live.provenance)) {
        return yield* refuseIfForeignProvenance('Grafana.ContactPoint', props.uid, live.provenance);
      }
      const settings = yield* resolveSettings(props);
      yield* grafana.routePutContactpoint({
        UID: props.uid,
        name: props.name,
        settings,
        type: props.type,
        uid: props.uid,
        ...(props.disableResolveMessage === undefined
          ? {}
          : { disableResolveMessage: props.disableResolveMessage }),
      });
    }),
};

export const handlers = grafanaHandlers(spec);

export const GrafanaContactPointProvider = () =>
  Provider.effect(GrafanaContactPoint, Effect.succeed(GrafanaContactPoint.Provider.of(handlers)));
