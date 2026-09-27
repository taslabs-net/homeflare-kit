# `@homeflare/alchemy/telemetry` — OTLP tracing/logging/metrics for a stack

`telemetryLayer` builds an OTLP/HTTP `Layer` for a stack's own `providers` — spans, logs and
metrics from `Effect.withSpan`, `HttpClient` calls and alchemy's own plan/apply engine, exported to
whatever OTLP collector a consumer names. Read 2026-09-26 against `alchemy@2.0.0-beta.79` and
`effect@4.0.0-rc.115`'s `effect/unstable/observability` module (this file names no estate host — see
below). See `telemetry-spike.md` for what was actually measured arriving at a collector.

Bodies are sent **protobuf-encoded** (`content-type: application/x-protobuf`), not JSON — measured
against the pinned binaries in homeflare-mini's own `src/obs`: VictoriaLogs 1.52.0 and
VictoriaMetrics 1.151.0 both answer OTLP/HTTP JSON with a `400`, and effect's exporter treats a 400
as non-transient and drops the batch silently at debug-only log level, so a JSON-encoded consumer
would see traces (VictoriaTraces alone tolerates JSON) but never logs or metrics, with no visible
error. There is no option to choose JSON instead.

## Off unless you give it endpoints

```ts
import { telemetryLayer } from '@homeflare/alchemy/telemetry';

export const providers = Layer.mergeAll(
  myProviders(),
  telemetryLayer({
    endpoints: {
      traces: 'http://victoria.example.test:10428/insert/opentelemetry/v1/traces',
      logs: 'http://victoria.example.test:9428/insert/opentelemetry/v1/logs',
      metrics: 'http://victoria.example.test:8428/opentelemetry/v1/metrics',
    },
    serviceName: 'my-stack',
  }),
);
```

Every entry in `endpoints` is optional and `undefined` by default — an entry you leave out sends
nothing for that signal, and `telemetryLayer({ endpoints: {} , … })` sends nothing at all
(`layer.test.ts`'s own "nothing sent when unconfigured"). There is no default collector anywhere in
this module; a consumer's own site config supplies real hosts. `victoria.example.test` above is an
RFC 2606 reserved name — put your actual Victoria host there, e.g. from a `bao read` or an
environment variable your site file already has.

The three paths above are VictoriaTraces/Logs/Metrics's own OTLP ingest paths (their upstream docs,
version-specific — verify against the versions you run, not this file, per this repo's own house
rule that a documented path is not true because it is written down). They are examples, not
defaults: `telemetryLayer` never assumes a path shape, since `OtlpTracer`/`OtlpLogger`/`OtlpMetrics`
each post to the exact `url` given, with nothing appended.

## Options

| option               | type                           | notes                                                              |
| -------------------- | ------------------------------ | ------------------------------------------------------------------ |
| `endpoints`          | `{ traces?, logs?, metrics? }` | full URLs, each independent — see above.                           |
| `serviceName`        | `string`                       | required — OTLP `service.name`.                                    |
| `serviceVersion`     | `string?`                      | OTLP `service.version`.                                            |
| `resourceAttributes` | `Record<string, unknown>?`     | extra OTLP resource attributes, e.g. `deployment.environment`.     |
| `redaction`          | `{ denylist?: string[] }?`     | see below.                                                         |
| `exportInterval`     | `Duration.Input?`              | default `'1 second'` — short on purpose, see `telemetry-spike.md`. |
| `logsMinimumLevel`   | `LogLevel.LogLevel?`           | default `'Info'` — floor for what `logs` exports; see below.       |

## Redaction — what leaves this process

Two passes run, at two different points, because no single hook sees every field (redteam PR 302,
2026-09-26 — `redact.ts`/`redact-serialization.ts` have the full detail):

1. **`redactAttribute`** (`redact.ts`) wraps the `Tracer.Tracer` itself, so it runs on every span
   attribute AS IT IS SET — provider spans, `HttpClient` client spans, and alchemy's own engine
   spans:
   - **Every HTTP header is dropped**, request or response, never merely value-redacted — a header
     NAME can itself be sensitive.
   - **Every query string is dropped** — `url.query` outright, and `url.full`'s own `?…`/`#…` — no
     per-parameter allowlist, since the next secret param a provider adds would otherwise leak.
   - **A denylisted host or path segment is blanked to `<redacted>`**, exact-segment match (never a
     substring), in `url.full`, `url.path` and `server.address` (bare hostname or full origin, both).
2. **`scrubText`/`redactTraceData`/`redactLogsData`** (`redact-serialization.ts`) run at
   `OtlpSerialization`, right before the wire body is built — the one place that also sees fields
   `redactAttribute` never does: `status.message` and the `exception.*` event attributes
   `OtlpTracer` builds from a failed span's `Cause` at export time, and a log line inside a span
   (turned into a span event by effect's default `tracerLogger` — the log message becomes the event
   NAME). These are free text, not a structured URL, so this pass matches a denylist entry as a
   **substring anywhere** in the string, and strips the query from any embedded URL. **Logs get the
   same pass** (`redactLogsData`) — a log record's body and its `log.error` (`Cause.pretty`, full
   formatted error text) attribute.

```ts
telemetryLayer({
  endpoints: { traces: 'http://victoria.example.test:10428/insert/opentelemetry/v1/traces' },
  redaction: { denylist: ['a1b2c3d4e5f6'] }, // e.g. a UniFi console id in the request path
  serviceName: 'my-stack',
});
```

Everything else — span names once scrubbed, timing, alchemy's own `alchemy.resource.*`/
`alchemy.stack` attributes, non-URL attributes a provider sets itself — passes through untouched. A
provider that puts a secret in a NON-url, non-header, non-denylisted attribute (e.g.
`Effect.withSpan('x', { attributes: { 'my.token': secret } })`) is not caught by either pass; that is
a provider bug this module cannot see, not a gap in the redaction rules above.

`logsMinimumLevel` (default `'Info'`) is a separate concern from redaction: the `alchemy` CLI sets
the GLOBAL minimum log level to Debug, and without a floor of its own the OTLP logger would ship
every Debug-level record. It applies only to what this layer exports — a consumer's console/file
loggers are unaffected. Metrics carry numeric data points, not provider-supplied free text, and pass
through both passes untouched.

## What this is not

This is **not** alchemy's own CLI telemetry (`alchemy`'s `src/Telemetry/Layer.ts`, hard-coded to
`otel.alchemy.run`, opted out of estate-wide via `~/.alchemy/telemetry-disabled`). That stays
retired for this decision (2026-09-26): this module is a per-stack, explicit-endpoint layer
each consumer opts into, not a CLI-wide install, and it never calls alchemy's endpoint or reads its
opt-out file.
