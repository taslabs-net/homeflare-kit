/**
 * `@homeflare/alchemy/telemetry` — an OTLP tracing/logging/metrics Layer for a stack's own
 * `providers`, off unless a consumer gives it real endpoints. See docs/telemetry.md for how a site
 * file wires it up and docs/telemetry-spike.md for what a stack's `providers` Layer can and cannot
 * capture (measured against alchemy 2.0.0-beta.79's own engine).
 */
export { telemetryLayer } from './layer.ts';
export type { TelemetryEndpoints, TelemetryOptions } from './layer.ts';
export { DROP, REDACTED, redactAttribute, wrapTracer } from './redact.ts';
export type { RedactionPolicy } from './redact.ts';
