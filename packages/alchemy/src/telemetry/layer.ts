/**
 * A Layer factory for OTLP tracing/logging/metrics, built for a stack's own `providers` Layer
 * rather than the CLI-wide install alchemy's own `Telemetry/Layer.ts` does (`src/Telemetry/
 * Layer.ts:13-15`, hard-coded to `otel.alchemy.run` with no override). Nothing here calls that
 * endpoint or knows it exists.
 *
 * ⛔ NO DEFAULTS THAT POINT ANYWHERE. `endpoints` is `{}` by default and `telemetryLayer` resolves
 *   to `Layer.empty` when every entry is `undefined` — see layer.test.ts's own "nothing sent
 *   when unconfigured". A consumer wires actual hosts from ITS OWN site config; see docs/telemetry.md.
 * ★ SEALED TRANSPORT — the caddy lesson (kit PR 293, admin.ts's own ⛔): merging a layer that still
 *   requires `HttpClient.HttpClient` into a stack's `providers` would let this module's own
 *   `FetchHttpClient` shadow a sibling fetch-based provider's client once both are merged into the
 *   same `Layer.mergeAll`. `Layer.provide` (not `Layer.provideMerge`) twice below feeds
 *   `FetchHttpClient`/`OtlpSerialization` to the OTLP layers and returns ONLY their own output —
 *   `HttpClient.HttpClient` never appears in what `telemetryLayer` hands back. See
 *   http-client-sealing.test.ts.
 * ★ PER-SIGNAL URLS, NOT ONE BASE URL. effect's own `Otlp.layer`/`layerJson` take a single
 *   `baseUrl` and post to `<baseUrl>/v1/{traces,metrics,logs}` — fine when one collector serves all
 *   three, wrong for Victoria's split binaries (VictoriaTraces/Logs/Metrics on three different
 *   ports/paths — docs/telemetry.md has the exact paths). `OtlpTracer`/`OtlpLogger`/`OtlpMetrics`
 *   each take their own `url` and post to it verbatim (OtlpExporter.ts `make`: `HttpClientRequest.
 *   post(options.url, …)`, no suffix appended) — exactly the shape three independent endpoints need.
 */
import type * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Tracer from 'effect/Tracer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import {
  OtlpExporter,
  OtlpLogger,
  OtlpMetrics,
  OtlpSerialization,
  OtlpTracer,
} from 'effect/unstable/observability';
import { type RedactionPolicy, wrapTracer } from './redact.ts';

/** Full OTLP/HTTP endpoint per signal — e.g. `http://127.0.0.1:10428/insert/opentelemetry/v1/traces`. Any entry left `undefined` sends nothing for that signal. */
export interface TelemetryEndpoints {
  readonly traces?: string;
  readonly logs?: string;
  readonly metrics?: string;
}

export interface TelemetryOptions {
  readonly endpoints: TelemetryEndpoints;
  /** OTLP `service.name` — required, since an unnamed service in a shared Victoria instance is unusable. */
  readonly serviceName: string;
  readonly serviceVersion?: string;
  /** Extra OTLP resource attributes (e.g. `{ "deployment.environment": "prod" }`). */
  readonly resourceAttributes?: Record<string, unknown>;
  readonly redaction?: RedactionPolicy;
  /**
   * How often a signal flushes its buffer.
   * @default '1 second' — short on purpose: alchemy invocations are CLI runs, often shorter than a
   * typical OTLP batch interval, so the export must fire well before the process could exit. The
   * scope's own shutdown flush (`Exporter.layerFlusher`) is the backstop for whatever this interval
   * misses; docs/telemetry-spike.md measured both paths.
   */
  readonly exportInterval?: Duration.Input;
}

// ⚠️ `exactOptionalPropertyTypes` — omit a key entirely rather than set it `undefined`, or the
//   OTLP layers' own `{ readonly attributes?: X }` (no `| undefined` in their own signatures)
//   rejects the object.
const resourceOf = (options: TelemetryOptions) => ({
  serviceName: options.serviceName,
  ...(options.serviceVersion !== undefined ? { serviceVersion: options.serviceVersion } : {}),
  ...(options.resourceAttributes !== undefined ? { attributes: options.resourceAttributes } : {}),
});

/**
 * `OtlpTracer.layer`'s own composition (OtlpTracer.ts: `flow(make, Layer.effect(Tracer.Tracer),
 * Layer.provideMerge(Exporter.layerFlusher))`), with `wrapTracer` inserted between `make` and
 * `Layer.effect` so every span this tracer creates is redacted before anything else can see it.
 */
const tracerLayer = (url: string, options: TelemetryOptions, exportInterval: Duration.Input) =>
  Layer.effect(
    Tracer.Tracer,
    Effect.map(OtlpTracer.make({ exportInterval, resource: resourceOf(options), url }), (inner) =>
      wrapTracer(inner, options.redaction ?? {}),
    ),
  ).pipe(Layer.provideMerge(OtlpExporter.layerFlusher));

/**
 * The Layer a consumer stack merges into its own `providers` — see docs/telemetry.md for how a
 * site file wires real hosts in, and docs/telemetry-spike.md for what a stack's `providers` Layer does and does
 * not carry a span for.
 *
 * ⚠️ FIXED THREE-ARG `Layer.mergeAll`, NOT AN ARRAY `.reduce`. Every signal slot is filled — with
 *   the real per-signal layer when its endpoint is set, `Layer.empty` when it is not — instead of
 *   building a variable-length array and folding it with `Layer.merge`. `Layer<in ROut, …>`
 *   declares its success channel CONTRAVARIANT, and once a fold's accumulator needs an explicit
 *   annotation to type-check under this repo's `exactOptionalPropertyTypes`, TS's overload
 *   resolution for `Layer.provide`/`Layer.merge` starts inferring `unknown` for that channel and
 *   then fails `unknown` against `never` (measured 2026-09-26, TS2769). `Layer.mergeAll`'s own
 *   fixed-arity overload — the exact shape alchemy's own `Telemetry/Layer.ts` uses for its three
 *   signals — infers cleanly with no annotation at all.
 */
export const telemetryLayer = (options: TelemetryOptions): Layer.Layer<never> => {
  const { traces, logs, metrics } = options.endpoints;
  if (traces === undefined && logs === undefined && metrics === undefined) return Layer.empty;
  // Default declared here, not in the options' type, so every call site above stays a concrete
  // `Duration.Input` — `exactOptionalPropertyTypes` rejects passing `undefined` through to the
  // OTLP layers' own `exportInterval?: Duration.Input` (no `| undefined` in their signatures).
  const exportInterval: Duration.Input = options.exportInterval ?? '1 second';
  const tracer = traces === undefined ? Layer.empty : tracerLayer(traces, options, exportInterval);
  const logger =
    logs === undefined
      ? Layer.empty
      : OtlpLogger.layer({ exportInterval, resource: resourceOf(options), url: logs });
  const meter =
    metrics === undefined
      ? Layer.empty
      : OtlpMetrics.layer({ exportInterval, resource: resourceOf(options), url: metrics });
  return Layer.mergeAll(tracer, logger, meter).pipe(
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(FetchHttpClient.layer),
  );
};
