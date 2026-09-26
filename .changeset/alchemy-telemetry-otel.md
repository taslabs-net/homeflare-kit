---
'@homeflare/alchemy': minor
---

New `@homeflare/alchemy/telemetry`: `telemetryLayer`, an OTLP tracing/logging/metrics `Layer` a
stack merges into its own `providers` — off unless given explicit `{ traces?, logs?, metrics? }`
endpoints, no default collector anywhere in it. This is not alchemy's own CLI-wide telemetry
(`otel.alchemy.run`, hard-coded, opted out via `~/.alchemy/telemetry-disabled`): it is a per-stack
layer a consumer opts into with its own endpoints (the estate's Victoria stack, in homeflare-mini's
case — this package names no estate host).

Every span — a provider's own, effect's `HttpClient` client spans, and alchemy's own plan/apply
engine spans — is redacted before export by wrapping the `Tracer.Tracer` itself: every HTTP header
dropped outright, every query string stripped, and a consumer-supplied denylist of host/path
segments (e.g. a UniFi console id) blanked to `<redacted>`. The transport is sealed — merging this
layer into a stack's `providers` alongside a fetch-based provider (Caddy, LiteLLM, Forgejo) never
lets its own `FetchHttpClient` leak into that provider's requirements, the same leak PR 293 fixed
for Caddy's admin transport.

See [docs/telemetry.md](../packages/alchemy/docs/telemetry.md) for how a consumer stack wires real
endpoints in, and [docs/telemetry-spike.md](../packages/alchemy/docs/telemetry-spike.md) for what an
offline spike against alchemy 2.0.0-beta.79's own engine measured actually arriving at a collector.
