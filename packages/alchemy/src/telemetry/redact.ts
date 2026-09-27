/**
 * URL/header redaction for outgoing spans — applied at the `Tracer.Tracer` boundary so it holds for
 * EVERY span source (a provider's own `Effect.withSpan`, effect's `HttpClient` client spans, and
 * alchemy's own plan/apply/resource spans), not just the ones a caller remembers to annotate.
 *
 * ★ WHY THE TRACER, NOT AN HTTPCLIENT MIDDLEWARE. effect's `HttpClient.make` (src/unstable/http/
 *   HttpClient.ts) hard-codes `span.attribute("url.full", …)`, `"url.query"` and
 *   `http.request.header.<name>` on the span it creates — there is no hook to stop it recording
 *   them. The one seam every span (HttpClient's included) passes through is `Tracer.span()`
 *   returning a `Tracer.Span`, so `wrapTracer` intercepts `Span.attribute()` there instead.
 * ⛔ NEVER RECORD HEADERS. A header NAME can itself be sensitive (`x-api-key`, a session cookie
 *   name), so every `http.{request,response}.header.*` key is DROPPED, not value-redacted.
 * ⚠️ QUERY STRINGS ARE STRIPPED WHOLE, not redacted per-parameter: an allowlist of "safe" params
 *   would silently leak the next secret param a provider adds. `url.query` is dropped outright and
 *   `url.full`/`url.path` never carry a `?…` past this point.
 */
import type * as Tracer from 'effect/Tracer';

/** Host or path segments to blank wherever they appear in a URL attribute — exact-segment match. */
export interface RedactionPolicy {
  /**
   * e.g. a UniFi console id embedded in a path (`/proxy/network/api/site/<id>/...`) or a private
   * hostname a consumer never wants leaving its own process. Compared against the full hostname and
   * against each `/`-separated path segment — never a substring match, so `"db"` cannot accidentally
   * blank `"db1.example.test"`.
   */
  readonly denylist?: ReadonlyArray<string>;
}

export const REDACTED = '<redacted>';

/** Returned by `redactAttribute` to mean "drop this attribute entirely — do not forward it". */
export const DROP: unique symbol = Symbol.for('homeflare/alchemy/telemetry/drop-attribute');

const HEADER_ATTRIBUTE = /^http\.(?:request|response)\.header\./;

const redactSegments = (value: string, denylist: ReadonlySet<string>): string =>
  value
    .split('/')
    .map((segment) => (denylist.has(segment) ? REDACTED : segment))
    .join('/');

/**
 * Applies `policy` to one span attribute. Returns `DROP` when the key must never be recorded at
 * all (every header); otherwise returns the value to record, with URLs stripped of their query
 * string and hash and their denylisted host/path segments blanked. A value this function does not
 * recognize (not a URL-shaped key, or not a string) passes through unchanged — alchemy's own
 * engine attributes (`resource.fqn`, `plan.action`, …) are never URLs and are never touched.
 */
export const redactAttribute = (key: string, value: unknown, policy: RedactionPolicy): unknown => {
  if (HEADER_ATTRIBUTE.test(key)) return DROP;
  if (key === 'url.query') return DROP;
  if (typeof value !== 'string') return value;
  const denylist = new Set(policy.denylist ?? []);
  if (denylist.size === 0 && key !== 'url.full' && key !== 'server.address') return value;
  // ⚠️ MEASURED 2026-09-26 (docs/telemetry-spike.md): effect's own `HttpClient.make` sets
  //   `server.address` to `url.origin` (`http://host:port`), NOT a bare hostname — a denylist entry
  //   naming just a hostname would never match the raw value, so this parses it out the same way
  //   `url.full` does.
  // ⛔ FIX (redteam PR 302 MINOR item 5, 2026-09-26): the OTel semantic convention's own default for
  //   `server.address` IS a bare hostname with no scheme (`new URL(value)` throws on that), and other
  //   instrumentation could emit exactly that even though effect's `HttpClient` doesn't today —
  //   `redactAttribute('server.address', 'db1.example.test', { denylist: ['db1.example.test'] })`
  //   returned the value verbatim before this fallback. Compare the raw string directly when it
  //   isn't a parseable URL, instead of giving up.
  if (key === 'server.address') {
    try {
      const url = new URL(value);
      return denylist.has(url.hostname) ? REDACTED : value;
    } catch {
      return denylist.has(value) ? REDACTED : value;
    }
  }
  if (key === 'url.path') return redactSegments(value, denylist);
  if (key === 'url.full') {
    try {
      const url = new URL(value);
      const host = denylist.has(url.hostname) ? REDACTED : url.host;
      return `${url.protocol}//${host}${redactSegments(url.pathname, denylist)}`;
    } catch {
      // Not a URL we can parse (a relative path effect couldn't resolve) — leave it verbatim
      // rather than guess; `url.full` is the one HttpClient always sets from a resolved `URL`, so
      // this branch is a defensive fallback, not the expected path.
      return value;
    }
  }
  return value;
};

const redactAttributes = (
  attributes: Record<string, unknown>,
  policy: RedactionPolicy,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    const redacted = redactAttribute(key, value, policy);
    if (redacted !== DROP) out[key] = redacted;
  }
  return out;
};

/**
 * Wraps a `Tracer.Tracer` so every span it creates redacts its attributes and event attributes
 * through `redactAttribute`/`redactAttributes` before they reach the real span (and therefore
 * before OTLP serialization ever sees them). Everything else — timing, status, links, the span's
 * own identity — passes straight through to `inner`.
 */
export const wrapTracer = (inner: Tracer.Tracer, policy: RedactionPolicy): Tracer.Tracer => ({
  context: inner.context,
  span(options): Tracer.Span {
    const real = inner.span(options);
    return {
      _tag: 'Span',
      spanId: real.spanId,
      traceId: real.traceId,
      parent: real.parent,
      annotations: real.annotations,
      get name() {
        return real.name;
      },
      get status() {
        return real.status;
      },
      get attributes() {
        return real.attributes;
      },
      get links() {
        return real.links;
      },
      sampled: real.sampled,
      kind: real.kind,
      end: (endTime, exit) => {
        real.end(endTime, exit);
      },
      attribute: (key, value) => {
        const redacted = redactAttribute(key, value, policy);
        if (redacted !== DROP) real.attribute(key, redacted);
      },
      event: (name, startTime, attributes) => {
        real.event(name, startTime, attributes ? redactAttributes(attributes, policy) : attributes);
      },
      addLinks: (links) => {
        real.addLinks(links);
      },
    };
  },
});
