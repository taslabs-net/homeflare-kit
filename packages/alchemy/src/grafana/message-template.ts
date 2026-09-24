/**
 * `Grafana.MessageTemplate` — one Grafana notification-template group, keyed by `name`.
 *
 * ⚠️ CREATE AND UPDATE ARE THE SAME WIRE CALL — MEASURED: `services/grafana.ts` has no
 *   `routePostTemplate` at all, only `routePutTemplate` (`PUT /v1/provisioning/templates/{name}`,
 *   upsert by name), `routeGetTemplate`/`routeGetTemplates` and `routeDeleteTemplate`. `spec.create`
 *   and `spec.update` both call it — kept as two separate functions anyway (rather than omitting
 *   `update` and letting them collapse into one) so the shared engine's `diff` reports a content
 *   change as `update`, not the `replace` it would show for any resource whose `spec.update` is
 *   undefined (`resource.ts`).
 *
 * ⛔ A FOREIGN-PROVENANCE TEMPLATE REFUSES EVERY UPDATE AND DESTROY — `alerting-provenance.ts`,
 *   shared with `Grafana.ContactPoint`/`AlertRuleGroup`/`NotificationPolicy`; see that file's
 *   header. `create` is never at risk: it only runs when `fetchLive` already found nothing.
 *
 * ⚠️ `version` IS SENT FOR OPTIMISTIC CONCURRENCY WHEN GRAFANA REPORTS ONE — `RoutePutTemplateRequest.
 *   version`'s own doc comment: "Version of template to use for optimistic concurrency. Leave empty
 *   to disable validation." Unlike `Grafana.Dashboard`'s 412, no live call confirms what error this
 *   produces on a genuine mismatch (no live calls in this PR) — whatever typed error the SDK
 *   declares for `routePutTemplate` is left uncaught either way, per the house rule against
 *   folding a non-not-found error into absent.
 *
 * ⚠️ `X-Disable-Provenance` IS NEVER SET — same reasoning as `contact-point.ts`'s file header.
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

export interface MessageTemplateProps {
  name: string;
  /** The Go-template body, e.g. Grafana's own "Export as JSON/YAML" template text. */
  template: string;
}

export interface MessageTemplateAttributes {
  name: string;
  template: string;
  /** `""`/`"api"` (this family may write); anything else, INCLUDING `undefined` (Grafana didn't
   *  report the field), refuses — see alerting-provenance.ts's "fails open" note. */
  provenance: string | undefined;
}

export interface GrafanaMessageTemplate extends Resource<
  'Grafana.MessageTemplate',
  MessageTemplateProps,
  MessageTemplateAttributes,
  never
> {}

export const GrafanaMessageTemplate = Resource<GrafanaMessageTemplate>('Grafana.MessageTemplate');

export const spec: GrafanaSpec<
  MessageTemplateProps,
  grafana.NotificationTemplate,
  MessageTemplateAttributes,
  | grafana.RouteGetTemplateError
  | grafana.RoutePutTemplateError
  | grafana.RouteDeleteTemplateError
  | GrafanaProvisionedObjectError
> = {
  attributes: (live) => ({
    name: live.name ?? '',
    // ⛔ NEVER `?? ''` — see alerting-provenance.ts's "fails open" note.
    provenance: live.provenance,
    template: live.template ?? '',
  }),
  create: (props) => grafana.routePutTemplate({ name: props.name, template: props.template }),
  destroy: (props, live) =>
    Effect.gen(function* () {
      if (isForeignProvenance(live.provenance)) {
        return yield* refuseIfForeignProvenance(
          'Grafana.MessageTemplate',
          props.name,
          live.provenance,
        );
      }
      yield* grafana.routeDeleteTemplate({ name: props.name });
    }),
  fetchLive: (props) =>
    grafana
      .routeGetTemplate({ name: props.name })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  matches: (attributes, props) => attributes.template === props.template,
  update: (props, live) =>
    Effect.gen(function* () {
      if (isForeignProvenance(live.provenance)) {
        return yield* refuseIfForeignProvenance(
          'Grafana.MessageTemplate',
          props.name,
          live.provenance,
        );
      }
      yield* grafana.routePutTemplate({
        name: props.name,
        template: props.template,
        ...(live.version === undefined ? {} : { version: live.version }),
      });
    }),
};

export const handlers = grafanaHandlers(spec);

export const GrafanaMessageTemplateProvider = () =>
  Provider.effect(
    GrafanaMessageTemplate,
    Effect.succeed(GrafanaMessageTemplate.Provider.of(handlers)),
  );
