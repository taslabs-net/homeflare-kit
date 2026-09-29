/**
 * Traces, logs and metrics from any Effect seat to VictoriaMetrics on CT100, from one
 * environment block.
 *
 * ★ `layerFromConfig`, NOT `Otlp.layer`. The combined layer takes ONE base URL and appends
 *   `/v1/traces` and friends, and the three Victoria services each mount OTLP at a different
 *   path (measured 2026-09-29, README). The per-signal layers read the per-signal env the
 *   Claude Code seats already carry, so one block wires every seat.
 * ⛔ WITH NO ENVIRONMENT `layerFromConfig` EXPORTS NOTHING, SILENTLY. It returns a bare
 *   flusher unless `OTEL_<SIGNAL>_EXPORTER` names `otlp` and an endpoint is set. So the CT100
 *   defaults below are not a convenience, they are what makes this layer emit at all.
 */
import * as Config from 'effect/Config';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import {
  type OtlpExporter,
  OtlpLogger,
  OtlpMetrics,
  OtlpSerialization,
  OtlpTracer,
} from 'effect/unstable/observability';

/**
 * CT100's Victoria services, one path each. Verified 2026-09-29 by GET against the live
 * ports (no payload sent): a mounted path answers, an unmounted sibling answers
 * `unsupported path requested`; the counters carry `format="protobuf"` for traces and logs.
 */
export const CT100_ENDPOINTS: {
  readonly traces: string;
  readonly logs: string;
  readonly metrics: string;
} = {
  traces: 'http://10.100.1.4:10428/insert/opentelemetry/v1/traces',
  logs: 'http://10.100.1.4:9428/insert/opentelemetry/v1/logs',
  metrics: 'http://10.100.1.4:8428/opentelemetry/v1/metrics',
};

/**
 * Shown when a process names itself neither with `OTEL_SERVICE_NAME` nor with a `service.name`
 * in `OTEL_RESOURCE_ATTRIBUTES`; set one per seat.
 */
export const DEFAULT_SERVICE_NAME = 'seat-runtime';

/**
 * `OTEL_RESOURCE_ATTRIBUTES` read the way Effect reads it (`OtlpResource.fromConfig`, rc.115:
 * `key=value` pairs, both sides URI-decoded), so "has a `service.name`" means what Effect means.
 */
const resourceAttributes = Config.Record(
  Schema.StringFromUriComponent,
  Schema.StringFromUriComponent,
  'OTEL_RESOURCE_ATTRIBUTES',
).pipe(Config.withDefault(undefined));

/**
 * The fallback config source, computed against the CURRENT provider.
 *
 * ⛔ EVERYTHING HERE IS A FALLBACK. The environment is tried first, so `OTEL_SDK_DISABLED=true`,
 *   `OTEL_TRACES_EXPORTER=none` and every endpoint the operator sets win.
 * ⚠️ THE PER-SIGNAL DEFAULTS STEP ASIDE FOR A BASE ENDPOINT. Effect reads
 *   `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` and only then `OTEL_EXPORTER_OTLP_ENDPOINT`, so a
 *   per-signal default would shadow an operator's base URL and send their traces to CT100.
 * ⚠️ THE SERVICE NAME STEPS ASIDE FOR `service.name` IN `OTEL_RESOURCE_ATTRIBUTES` FOR THE SAME
 *   REASON. Effect resolves `OTEL_SERVICE_NAME`, then that attribute, then fails, so an injected
 *   `OTEL_SERVICE_NAME` would win over the operator's attribute and Effect then drops the
 *   attribute, leaving their seat mislabelled `seat-runtime` in Victoria with nothing to say why.
 */
const defaults: Effect.Effect<ConfigProvider.ConfigProvider> = Effect.gen(function* () {
  const current = yield* ConfigProvider.ConfigProvider;
  const base = yield* current.load(['OTEL_EXPORTER_OTLP_ENDPOINT']);
  const attributes = yield* resourceAttributes.parse(current);
  const named = attributes?.['service.name'] !== undefined;
  return ConfigProvider.fromUnknown({
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_METRICS_EXPORTER: 'otlp',
    ...(named ? {} : { OTEL_SERVICE_NAME: DEFAULT_SERVICE_NAME }),
    ...(base === undefined
      ? {
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: CT100_ENDPOINTS.traces,
          OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: CT100_ENDPOINTS.logs,
          OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: CT100_ENDPOINTS.metrics,
        }
      : {}),
  });
}).pipe(Effect.orDie);

/**
 * OTLP tracer, logger and metrics over `fetch`, protobuf on the wire (what VictoriaTraces,
 * VictoriaLogs and VictoriaMetrics ingest, and what the Claude Code seats already send).
 */
export const layer: Layer.Layer<OtlpExporter.Flusher> = Layer.mergeAll(
  OtlpTracer.layerFromConfig(),
  OtlpLogger.layerFromConfig(),
  OtlpMetrics.layerFromConfig(),
).pipe(
  Layer.provide(OtlpSerialization.layerProtobuf),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(ConfigProvider.layerAdd(defaults)),
);
