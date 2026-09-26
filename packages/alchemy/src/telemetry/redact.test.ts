/**
 * Pure-function coverage for `redactAttribute`/`wrapTracer`. layer.test.ts covers the same policy
 * end to end, through a real `HttpClient` call and a real OTLP export — this file is the fast,
 * exhaustive sweep of the redaction rules themselves.
 */
import { describe, expect, test } from 'bun:test';
import * as Option from 'effect/Option';
import type * as Tracer from 'effect/Tracer';
import { DROP, REDACTED, redactAttribute, wrapTracer } from './redact.ts';

describe('redactAttribute', () => {
  test('drops every header attribute outright, request or response, regardless of value', () => {
    expect(redactAttribute('http.request.header.authorization', 'Bearer x', {})).toBe(DROP);
    expect(redactAttribute('http.request.header.x-api-key', 'k', {})).toBe(DROP);
    expect(redactAttribute('http.response.header.set-cookie', 'a=b', {})).toBe(DROP);
  });

  test('drops url.query outright — no per-parameter allowlist', () => {
    expect(redactAttribute('url.query', 'token=SECRET&safe=1', {})).toBe(DROP);
  });

  test('strips the query string and hash from url.full even with an empty policy', () => {
    expect(redactAttribute('url.full', 'http://host/path?token=SECRET#frag', {})).toBe(
      'http://host/path',
    );
  });

  test('leaves url.full, url.path and server.address untouched when nothing matches the denylist', () => {
    expect(redactAttribute('url.full', 'http://host:9428/insert/opentelemetry/v1/traces', {})).toBe(
      'http://host:9428/insert/opentelemetry/v1/traces',
    );
    expect(redactAttribute('url.path', '/insert/opentelemetry/v1/traces', {})).toBe(
      '/insert/opentelemetry/v1/traces',
    );
    expect(redactAttribute('server.address', 'http://host:9428', {})).toBe('http://host:9428');
  });

  test('blanks a denylisted path segment, exact match only — no substring match', () => {
    const policy = { denylist: ['console-abc123'] };
    expect(redactAttribute('url.path', '/proxy/network/console-abc123/site', policy)).toBe(
      `/proxy/network/${REDACTED}/site`,
    );
    // "console-abc123-extra" must NOT match the denylisted "console-abc123" segment.
    expect(redactAttribute('url.path', '/proxy/console-abc123-extra', policy)).toBe(
      '/proxy/console-abc123-extra',
    );
  });

  test('blanks a denylisted host in both url.full and server.address', () => {
    const policy = { denylist: ['private.example.test'] };
    expect(redactAttribute('server.address', 'https://private.example.test:443', policy)).toBe(
      REDACTED,
    );
    expect(redactAttribute('url.full', 'https://private.example.test/api/site/x?y=1', policy)).toBe(
      `https://${REDACTED}/api/site/x`,
    );
  });

  test('a non-string value (e.g. server.port) and an unrecognized key pass through untouched', () => {
    expect(redactAttribute('server.port', 8428, { denylist: ['8428'] })).toBe(8428);
    expect(redactAttribute('alchemy.resource.fqn', 'stack/thing', { denylist: ['thing'] })).toBe(
      'stack/thing',
    );
  });

  test('a url.full value that fails to parse as a URL is left verbatim, not guessed at', () => {
    expect(redactAttribute('url.full', 'not a url', { denylist: ['not'] })).toBe('not a url');
  });
});

const testSpanOptions = {
  annotations: undefined as never,
  kind: 'internal' as const,
  links: [],
  name: 'test',
  parent: Option.none(),
  root: true,
  sampled: true,
  startTime: 0n,
};

const recordingInner = (): { calls: Array<[string, unknown]>; tracer: Tracer.Tracer } => {
  const calls: Array<[string, unknown]> = [];
  const tracer: Tracer.Tracer = {
    span: (options) => ({
      _tag: 'Span',
      addLinks: () => {},
      annotations: options.annotations,
      attribute: (key, value) => calls.push([key, value]),
      attributes: new Map(),
      end: () => {},
      event: () => {},
      kind: options.kind,
      links: options.links,
      name: options.name,
      parent: options.parent,
      sampled: options.sampled,
      spanId: 'span-1',
      status: { _tag: 'Started', startTime: options.startTime },
      traceId: 'trace-1',
    }),
  };
  return { calls, tracer };
};

describe('wrapTracer', () => {
  test('forwards an allowed attribute and withholds a dropped one from the real span', () => {
    const { calls, tracer } = recordingInner();
    const wrapped = wrapTracer(tracer, {});
    const span = wrapped.span(testSpanOptions);
    span.attribute('http.request.header.cookie', 'secret');
    span.attribute('alchemy.resource.fqn', 'stack/thing');
    expect(calls).toEqual([['alchemy.resource.fqn', 'stack/thing']]);
  });

  test("passes the span's identity and lifecycle through unchanged", () => {
    const { tracer } = recordingInner();
    const wrapped = wrapTracer(tracer, {});
    const span = wrapped.span(testSpanOptions);
    expect(span.name).toBe('test');
    expect(span.spanId).toBe('span-1');
    expect(span.traceId).toBe('trace-1');
  });
});
