/**
 * `Grafana.MuteTiming` — one Grafana alerting mute timing, keyed by `name` (there is no separate
 * `uid` — `routeGetMuteTiming`/`routePutMuteTiming`/`routeDeleteMuteTiming` are all name-keyed on
 * the wire, and `name` is the field a notification policy's own `mute_time_intervals` references).
 *
 * ★ `provenance`/`version` ARE READ THROUGH A WIDENED TYPE, NOT THE SDK's OWN `MuteTimeInterval` —
 *   MEASURED, and a genuinely surprising result worth recording in full. The SDK's generated
 *   `MuteTimeInterval` interface (`packages/distilled-grafana/src/services/grafana.ts`) declares
 *   only `name`/`time_intervals` — no `provenance`, no `version` — unlike `EmbeddedContactPoint`/
 *   `NotificationTemplate`/`ProvisionedAlertRule`/`Route`, which all carry `provenance`. A first
 *   pass at this file assumed that meant the data was gone: decoding a raw payload containing both
 *   fields through `S.decodeUnknownSync(MuteTimeInterval)` directly DOES strip them. But that is
 *   the wrong code path — it is not what `routeGetMuteTiming` itself does. Proven empirically by
 *   calling the REAL operation (through `fake-grafana.ts`'s harness, the exact path this file's own
 *   `fetchLive` uses) with a response body containing `provenance`/`version`: both come through on
 *   the decoded value intact. The mechanism, read from `@distilled.cloud/core@1.0.0-rc.12`'s
 *   `protocol-rest.ts`/`protocol-http.ts` (the runtime this SDK's every operation shares): response
 *   decoding is `JSON.parse` + `mapKeys` (renames only the field names a schema DOES declare) +
 *   `wrapSensitive` (wraps only fields a schema marks sensitive in `Redacted`) — never a strict
 *   `Schema.decode`. `protocol-http.ts`'s `mapKeys`, object branch: every response key NOT among a
 *   type's declared `props` is copied to the output verbatim in a second pass
 *   (`for (const [k, v] of Object.entries(value)) { if (consumed.has(k)) continue; out[k] = v; }`,
 *   line ~297-311) — the doc comment on the sibling `wrapSensitive` states the same rule plainly:
 *   "Keys the schema doesn't model pass through verbatim." So the TS type is simply narrower than
 *   the runtime value; `MuteTimeIntervalWire` below is that same runtime value, typed honestly.
 *   This is a real, worth-fixing SDK type-generation gap (tracked in `docs/upstream-conformance.md`,
 *   same S22 route as the other named gaps) but NOT a data-loss gap — unlike, say, a field the wire
 *   protocol itself never sent, this one is fully recoverable without touching vendored `src/`.
 *
 *   The same test proved the outbound direction too: an object with extra keys (`weekdays`, `times`
 *   — the real Alertmanager time-interval fields Grafana's OpenAPI's own `TimeInterval` schema
 *   apparently fails to model either, for the same reason) passed to `routePutMuteTiming` reaches
 *   the wire body unchanged — `mapKeys`'s encode direction is the same verbatim-passthrough rule.
 *   `MuteTimingProps.timeIntervals` is therefore typed as the opaque `Record<string, unknown>`
 *   shape actually needed to declare a real mute timing (weekdays/times/months/etc.), not the
 *   SDK's own too-narrow `TimeInterval`, and cast at the two call sites below.
 *
 * ⚠️ THE EVIDENCE ABOVE IS A HAND-AUTHORED FIXTURE, NOT A CAPTURED REAL RESPONSE — flagged by an
 *   adversarial review of this PR. The estate has zero live mute timings to observe (grafana.md's
 *   census), so nothing confirms Grafana always includes `provenance` on this route in practice,
 *   or that some other SDK/version edge case never drops it. That is exactly why `attributes()`
 *   below never coerces a missing `live.provenance` to `''` — see alerting-provenance.ts's "fails
 *   open" note — an absent field refuses a write rather than being trusted as `ProvenanceNone`.
 *
 * ⛔ A FOREIGN-PROVENANCE MUTE TIMING REFUSES EVERY UPDATE AND DESTROY — `alerting-provenance.ts`,
 *   shared with `Grafana.ContactPoint`/`MessageTemplate`/`AlertRuleGroup`/`NotificationPolicy`; see
 *   that file's header. `create` is never at risk: it only runs when `fetchLive` already found
 *   nothing with this `name`.
 *
 * ⚠️ `version` IS SENT ON DESTROY, NOT ON UPDATE — MEASURED: `RouteDeleteMuteTimingRequest.version`
 *   ("Version of mute timing to use for optimistic concurrency. Leave empty to disable validation")
 *   exists; `RoutePutMuteTimingRequest` has no `version` field at all, so an update has nothing to
 *   send for it — a real Grafana API asymmetry between the two write routes, not an omission here.
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
import { declaredContentMatches } from './subset-match.ts';

export interface MuteTimingProps {
  name: string;
  /** Grafana's Alertmanager-style time-interval entries (`weekdays`/`times`/`months`/…), passed
   *  through opaquely — see the file header for why this is not the SDK's own `TimeInterval`. */
  timeIntervals: ReadonlyArray<Record<string, unknown>>;
}

export interface MuteTimingAttributes {
  name: string;
  timeIntervals: ReadonlyArray<Record<string, unknown>>;
  /** `""`/`"api"` (this family may write); anything else, INCLUDING `undefined` (Grafana didn't
   *  report the field, or the widened-type passthrough this file depends on turns out not to hold
   *  for some response shape not yet observed), refuses — see alerting-provenance.ts's "fails
   *  open" note. This is the field where that default matters most: unlike the other resources in
   *  this family, `provenance` here is not even in the SDK's declared type. */
  provenance: string | undefined;
}

export interface GrafanaMuteTiming extends Resource<
  'Grafana.MuteTiming',
  MuteTimingProps,
  MuteTimingAttributes,
  never
> {}

export const GrafanaMuteTiming = Resource<GrafanaMuteTiming>('Grafana.MuteTiming');

/** The real runtime shape of a `GET`/list response — see the file header's "measured" note. */
type MuteTimeIntervalWire = grafana.MuteTimeInterval & {
  provenance?: string;
  version?: string;
};

export const spec: GrafanaSpec<
  MuteTimingProps,
  MuteTimeIntervalWire,
  MuteTimingAttributes,
  | grafana.RouteGetMuteTimingError
  | grafana.RoutePostMuteTimingError
  | grafana.RoutePutMuteTimingError
  | grafana.RouteDeleteMuteTimingError
  | GrafanaProvisionedObjectError
> = {
  attributes: (live) => ({
    name: live.name ?? '',
    // ⛔ NEVER `?? ''` — see alerting-provenance.ts's "fails open" note, and this file's own
    //   Attributes doc comment on why it matters most here.
    provenance: live.provenance,
    timeIntervals: (live.time_intervals ?? []) as unknown as ReadonlyArray<Record<string, unknown>>,
  }),
  create: (props) =>
    grafana.routePostMuteTiming({
      name: props.name,
      time_intervals:
        props.timeIntervals as unknown as grafana.RoutePostMuteTimingRequestTimeIntervalsList,
    }),
  destroy: (props, live) =>
    Effect.gen(function* () {
      if (isForeignProvenance(live.provenance)) {
        return yield* refuseIfForeignProvenance('Grafana.MuteTiming', props.name, live.provenance);
      }
      yield* grafana.routeDeleteMuteTiming({
        name: props.name,
        ...(live.version === undefined ? {} : { version: live.version }),
      });
    }),
  fetchLive: (props) =>
    grafana.routeGetMuteTiming({ name: props.name }).pipe(
      Effect.map((live) => live as MuteTimeIntervalWire),
      Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
    ),
  /** Subset match (subset-match.ts), not plain equality — tolerates a default Grafana might
   *  inject into a time-interval entry the declaration never set. */
  matches: (attributes, props) =>
    declaredContentMatches(props.timeIntervals, attributes.timeIntervals),
  update: (props, live) =>
    Effect.gen(function* () {
      if (isForeignProvenance(live.provenance)) {
        return yield* refuseIfForeignProvenance('Grafana.MuteTiming', props.name, live.provenance);
      }
      yield* grafana.routePutMuteTiming({
        name: props.name,
        time_intervals:
          props.timeIntervals as unknown as grafana.RoutePutMuteTimingRequestTimeIntervalsList,
      });
    }),
};

export const handlers = grafanaHandlers(spec);

export const GrafanaMuteTimingProvider = () =>
  Provider.effect(GrafanaMuteTiming, Effect.succeed(GrafanaMuteTiming.Provider.of(handlers)));
