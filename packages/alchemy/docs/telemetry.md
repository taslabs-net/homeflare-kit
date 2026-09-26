# `@homeflare/alchemy/telemetry` — OTLP tracing/logging/metrics for a stack

`telemetryLayer` builds an OTLP/HTTP `Layer` for a stack's own `providers` — spans, logs and
metrics from `Effect.withSpan`, `HttpClient` calls and alchemy's own plan/apply engine, exported to
whatever OTLP collector a consumer names. Read 2026-09-26 against `alchemy@2.0.0-beta.79` and
`effect@4.0.0-rc.115`'s `effect/unstable/observability` module. See `telemetry-spike.md` for what
was actually measured arriving at a collector, and this package's own README for how the estate's
Victoria stack fits in (this file names no estate host — see below).

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

## Redaction — what leaves this process

`redactAttribute` runs on every span attribute (provider spans, `HttpClient` client spans, and
alchemy's own engine spans, since it wraps the `Tracer.Tracer` itself — see `redact.ts`'s own
header for why the tracer and not an `HttpClient` middleware):

- **Every HTTP header is dropped**, request or response, never merely value-redacted — a header
  NAME can itself be sensitive.
- **Every query string is dropped** — `url.query` outright, and `url.full`'s own `?…`/`#…` — no
  per-parameter allowlist, since the next secret param a provider adds would otherwise leak.
- **A denylisted host or path segment is blanked to `<redacted>`**, exact-segment match only (never
  a substring), in `url.full`, `url.path` and `server.address`:

  ```ts
  telemetryLayer({
    endpoints: { traces: 'http://victoria.example.test:10428/insert/opentelemetry/v1/traces' },
    redaction: { denylist: ['a1b2c3d4e5f6'] }, // e.g. a UniFi console id in the request path
    serviceName: 'my-stack',
  });
  ```

Everything else — span names, timing, status, alchemy's own `alchemy.resource.*`/`alchemy.stack`
attributes, non-URL attributes a provider sets itself — passes through untouched. A provider that
puts a secret in a NON-url, non-header attribute (e.g. `Effect.withSpan('x', { attributes: {
'my.token': secret } })`) is not caught by this policy; that is a provider bug this module cannot
see, not a gap in the redaction rules above.

## Logs and metrics carry no redaction

Only the tracer is wrapped. `OtlpLogger`/`OtlpMetrics` install unmodified — Effect's default
logger/metrics registries do not carry URLs or headers the way `HttpClient`'s own span attributes
do, so there is nothing this module's redaction rules apply to today. A provider that logs a raw
URL itself (`Effect.logInfo(request.url)`) is, again, a provider bug outside this module's reach.

## What this is not

This is **not** alchemy's own CLI telemetry (`alchemy`'s `src/Telemetry/Layer.ts`, hard-coded to
`otel.alchemy.run`, opted out of estate-wide via `~/.alchemy/telemetry-disabled`). That stays
retired for this decision (Tim, 2026-09-26): this module is a per-stack, explicit-endpoint layer
each consumer opts into, not a CLI-wide install, and it never calls alchemy's endpoint or reads its
opt-out file.
