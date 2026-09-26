/**
 * Free-text OTLP redaction applied at `OtlpSerialization` — the ONE place every span/log field
 * reaches the wire, right before HTTP body encoding. `redact.ts`'s `wrapTracer` only sees what a
 * caller passes to `Span.attribute()`/`Span.event()`; two real fields never go through either hook:
 *
 * - `status.message` and the `exception.*` event attributes `OtlpTracer`'s own `makeOtlpSpan` builds
 *   from `Cause.prettyErrors(exit.cause)` — computed at export time, inside effect's tracer, AFTER
 *   `wrapTracer.end()` has already handed the exit straight to `real.end()`.
 * - a log line inside a span, turned into a span event by effect's default `tracerLogger` — the log
 *   message becomes the event NAME (not an attribute `wrapTracer.event()` redacts), and its
 *   `effect.cause` attribute is free text `redactAttribute`'s key-based rules never recognize.
 *
 * Redteam finding (PR 302, 2026-09-26): a provider GET that 404'd exported `exception.message =
 * "... 404 GET http://host/secret-site-abc123/probe?token=SECRET123"` unredacted — the query, the
 * denylisted path segment and the denylisted host all went out. A `logWarning` inside a span leaked
 * the same way through the event name.
 *
 * ⚠️ SUBSTRING MATCH, NOT SEGMENT MATCH. `redactAttribute` compares a denylist entry against a whole
 *   `/`-bounded URL segment on purpose (`redact.ts`'s own ⚠️: `"db"` must not blank `"db1.example.
 *   test"`). Free text has no segment boundaries — a log message or a formatted `Cause` embeds a
 *   token in prose — so `scrubText` matches a denylist entry as a literal substring ANYWHERE in the
 *   string. This is strictly broader than the structured rules, so it also closes the `server.
 *   address` bare-hostname and legacy `http.url` gaps (redteam MINOR item 5) as a side effect: a
 *   denylisted hostname is a substring match wherever it appears, URL-shaped or not. The tradeoff a
 *   caller accepts by naming a short, common word in `denylist` is over-redaction, never a leak.
 */
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { OtlpSerialization } from 'effect/unstable/observability';
import type { OtlpLogger, OtlpResource, OtlpTracer } from 'effect/unstable/observability';
import { REDACTED, type RedactionPolicy } from './redact.ts';

const URL_PATTERN = /https?:\/\/[^\s"'<>)]+/g;

/** Strips an embedded URL's query/hash and blanks its denylisted host/path segments — `redact.ts`'s
 * `url.full` case, reused here because a URL can appear inside prose, not just as its own attribute. */
const scrubUrl = (raw: string, denylist: ReadonlySet<string>): string => {
  try {
    const url = new URL(raw);
    const host = denylist.has(url.hostname) ? REDACTED : url.host;
    const path = url.pathname
      .split('/')
      .map((segment) => (denylist.has(segment) ? REDACTED : segment))
      .join('/');
    return `${url.protocol}//${host}${path}`;
  } catch {
    return raw; // Matched the URL_PATTERN regex but `URL` still rejects it — leave verbatim.
  }
};

/** Redacts one piece of free text: every embedded URL loses its query string and denylisted
 * segments, then every denylist entry is blanked as a substring anywhere else in the text. */
export const scrubText = (text: string, policy: RedactionPolicy): string => {
  const denylist = policy.denylist ?? [];
  const denylistSet = new Set(denylist);
  let out = text.replace(URL_PATTERN, (match) => scrubUrl(match, denylistSet));
  for (const token of denylist) {
    if (token.length === 0) continue; // an empty entry would blank every character boundary
    out = out.split(token).join(REDACTED);
  }
  return out;
};

/** Walks one OTLP `AnyValue`'s string leaves (`stringValue`, and recursively through `arrayValue`/
 * `kvlistValue`) — the union effect's OTLP encoders use for every attribute and log body value. */
const scrubValue = (
  value: OtlpResource.AnyValue,
  policy: RedactionPolicy,
): OtlpResource.AnyValue => {
  if (typeof value.stringValue === 'string')
    return { ...value, stringValue: scrubText(value.stringValue, policy) };
  if (value.arrayValue !== undefined) {
    return {
      ...value,
      arrayValue: { values: value.arrayValue.values.map((v) => scrubValue(v, policy)) },
    };
  }
  if (value.kvlistValue !== undefined) {
    return {
      ...value,
      kvlistValue: {
        values: value.kvlistValue.values.map((kv) => ({
          key: kv.key,
          value: scrubValue(kv.value, policy),
        })),
      },
    };
  }
  return value; // boolValue / intValue / doubleValue / bytesValue — never free text.
};

const scrubKeyValues = (
  attributes: ReadonlyArray<OtlpResource.KeyValue>,
  policy: RedactionPolicy,
): Array<OtlpResource.KeyValue> =>
  attributes.map((kv) => ({ key: kv.key, value: scrubValue(kv.value, policy) }));

/** `TraceData` after every span's name, attributes, events (including the `exception.*` ones
 * `makeOtlpSpan` builds from the exit), status message and link attributes have been scrubbed. */
export const redactTraceData = (
  data: OtlpTracer.TraceData,
  policy: RedactionPolicy,
): OtlpTracer.TraceData => ({
  resourceSpans: data.resourceSpans.map((resourceSpan) => ({
    ...resourceSpan,
    scopeSpans: resourceSpan.scopeSpans.map((scopeSpan) => ({
      ...scopeSpan,
      spans: scopeSpan.spans.map((span) => ({
        ...span,
        attributes: scrubKeyValues(span.attributes, policy),
        events: span.events.map((event) => ({
          ...event,
          attributes: scrubKeyValues(event.attributes, policy),
          name: scrubText(event.name, policy),
        })),
        links: span.links.map((link) => ({
          ...link,
          attributes: scrubKeyValues(link.attributes, policy),
        })),
        name: scrubText(span.name, policy),
        status:
          span.status.message === undefined
            ? span.status
            : { ...span.status, message: scrubText(span.status.message, policy) },
      })),
    })),
  })),
});

type LogRecord = NonNullable<
  OtlpLogger.LogsData['resourceLogs'][number]['scopeLogs'][number]['logRecords']
>[number];

// ⚠️ `exactOptionalPropertyTypes` — `body` is `AnyValue?` with no `| undefined` in its own
//   signature (matches `layer.ts`'s own `resourceOf` note), so an absent one is OMITTED, not set to
//   `undefined`, or this object-literal return fails to type-check against `ILogRecord`.
const scrubLogRecord = (record: LogRecord, policy: RedactionPolicy): LogRecord => ({
  ...record,
  attributes: scrubKeyValues(record.attributes, policy),
  ...(record.body !== undefined ? { body: scrubValue(record.body, policy) } : {}),
});

/** `LogsData` after every log record's attributes and body have been scrubbed — the fix for redteam
 * item 4's "logs ship unredacted": `log.error` (`Cause.pretty`) and the message body are free text. */
export const redactLogsData = (
  data: OtlpLogger.LogsData,
  policy: RedactionPolicy,
): OtlpLogger.LogsData => ({
  resourceLogs: data.resourceLogs.map((resourceLog) => ({
    ...resourceLog,
    scopeLogs: resourceLog.scopeLogs.map((scopeLog) => ({
      ...scopeLog,
      // Same `exactOptionalPropertyTypes` reasoning as `scrubLogRecord` — omit `logRecords`
      // entirely rather than assign it `undefined` when the source had none.
      ...(scopeLog.logRecords !== undefined
        ? { logRecords: scopeLog.logRecords.map((record) => scrubLogRecord(record, policy)) }
        : {}),
    })),
  })),
});

/**
 * Wraps the real `OtlpSerialization` so `telemetryLayer` gets this free-text pass on every signal
 * with no separate wiring at each call site — `layer.ts` provides this in place of a bare
 * `OtlpSerialization.layerProtobuf`. Metrics pass through untouched: they carry numeric data points
 * keyed by `Metric.Metric.AttributeSet`, not provider-supplied free text.
 */
export const redactedSerialization = (
  policy: RedactionPolicy,
): Layer.Layer<OtlpSerialization.OtlpSerialization> =>
  Layer.effect(
    OtlpSerialization.OtlpSerialization,
    Effect.map(OtlpSerialization.OtlpSerialization, (inner) => ({
      logs: (data: OtlpLogger.LogsData) => inner.logs(redactLogsData(data, policy)),
      metrics: inner.metrics,
      traces: (data: OtlpTracer.TraceData) => inner.traces(redactTraceData(data, policy)),
    })),
  ).pipe(Layer.provide(OtlpSerialization.layerProtobuf));
