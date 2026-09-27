/**
 * `telemetryLayer` end to end, over the REAL engine (`verify/fake-engine.ts`'s `engineOver` — real
 * `Alchemy.Stack` + `Plan.make` + `apply`, an in-memory state store, no network beyond the fake
 * OTLP collector below) — not a hand-built stand-in. docs/telemetry-spike.md is the exploratory run this distills
 * into permanent coverage; see it for what a stack's `providers` Layer can and cannot capture.
 *
 * ★ A REAL `FetchHttpClient` IS MERGED IN AS `ambient`, standing in for the platform layer a real
 *   `alchemy.run.ts`'s `Stack.ts` provides underneath the merged `providers` — exactly the shape
 *   admin-transport-scope.test.ts documents for caddy. Without it the fake provider's own
 *   `HttpClient.HttpClient` requirement has nothing to resolve to, proving on its own (a thrown
 *   "Service not found") that `telemetryLayer`'s SEALED internal client never leaks out —
 *   http-client-sealing.test.ts makes that assertion explicit instead of relying on a crash.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import { engineOver } from '../verify/fake-engine.ts';
import { type FakeCollector, fakeCollector } from './fake-collector.ts';
import { telemetryLayer } from './layer.ts';

interface Thing extends Resource<'Test.TelemetryThing', { name: string }, { name: string }> {}
const Thing = Resource<Thing>('Test.TelemetryThing');

/** Calls `target` (`GET <target>/probe?token=…`, an `authorization` header set) inside its own
 * span — a stand-in for a real provider's own `Effect.withSpan` around an SDK call. */
const probingProvider = (target: string) =>
  Provider.succeed(Thing, {
    read: () => Effect.succeed(undefined),
    reconcile: () =>
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const request = HttpClientRequest.get(`${target}/probe?token=SECRET123`).pipe(
          HttpClientRequest.setHeader('authorization', 'Bearer sekrit'),
        );
        const response = yield* client.execute(request);
        yield* response.text;
        return { name: 'x' };
      }).pipe(Effect.withSpan('probe.custom-span')),
    delete: () => Effect.void,
  });

let collectors: FakeCollector[] = [];
const collector = (): FakeCollector => {
  const c = fakeCollector();
  collectors.push(c);
  return c;
};
/** A plain HTTP server for the redteam repros below — a real "target" a provider calls, not an OTLP
 * collector, so it doesn't belong in `collectors`/`FakeCollector`. */
let servers: Array<{ stop: () => void }> = [];
afterEach(() => {
  for (const c of collectors) c.stop();
  collectors = [];
  for (const s of servers) s.stop();
  servers = [];
});

/** A target that answers every request 404 — a provider call that fails. */
const notFound = (): string => {
  const server = Bun.serve({
    fetch: () => new Response('nope', { status: 404 }),
    hostname: '127.0.0.1',
    port: 0,
  });
  servers.push({ stop: () => void server.stop(true) });
  return `http://127.0.0.1:${String(server.port)}`;
};

describe('telemetryLayer', () => {
  test('sends nothing to any signal when every endpoint is left unconfigured', async () => {
    const otlp = collector();
    const target = collector();
    const providers = Layer.mergeAll(
      probingProvider(target.url),
      telemetryLayer({ endpoints: {}, serviceName: 'test' }),
    ).pipe(Layer.provideMerge(FetchHttpClient.layer));
    await engineOver(providers).deploy(Thing('t', { name: 'x' }));
    expect(otlp.requests.length).toBe(0);
  });

  test("provider spans, HttpClient client spans and alchemy's own engine spans all arrive", async () => {
    const otlp = collector();
    const target = collector();
    const providers = Layer.mergeAll(
      probingProvider(target.url),
      telemetryLayer({ endpoints: { traces: `${otlp.url}/v1/traces` }, serviceName: 'test' }),
    ).pipe(Layer.provideMerge(FetchHttpClient.layer));
    await engineOver(providers).deploy(Thing('t', { name: 'x' }));
    // The provider's own span, the HttpClient client span it made, and alchemy's OWN engine
    // instrumentation (Apply.ts `instrumentLifecycle`/`apply`/`apply.resource`, Plan.ts
    // `plan.make`) — measured together in docs/telemetry-spike.md's run against beta.79.
    for (const name of [
      'probe.custom-span',
      'http.client GET',
      'provider.create',
      'apply',
      'apply.resource',
      'plan.make',
    ]) {
      expect(otlp.sawText(name)).toBe(true);
    }
  });

  test('redteam PR 302 item 1: OTLP bodies are protobuf, not JSON', async () => {
    const otlp = collector();
    const target = collector();
    const providers = Layer.mergeAll(
      probingProvider(target.url),
      telemetryLayer({ endpoints: { traces: `${otlp.url}/v1/traces` }, serviceName: 'test' }),
    ).pipe(Layer.provideMerge(FetchHttpClient.layer));
    await engineOver(providers).deploy(Thing('t', { name: 'x' }));
    const request = otlp.at('/v1/traces')[0];
    // VictoriaLogs/Metrics answer OTLP JSON with 400 "json encoding isn't supported" — only
    // protobuf's `content-type` ingests on all three (docs/telemetry-spike.md's follow-up measurement).
    expect(request?.headers.get('content-type')).toBe('application/x-protobuf');
  });

  test('redaction holds for a real HttpClient call: no query string, no headers, denylisted host blanked', async () => {
    const otlp = collector();
    const target = collector();
    const targetHost = new URL(target.url).hostname;
    const providers = Layer.mergeAll(
      probingProvider(target.url),
      telemetryLayer({
        endpoints: { traces: `${otlp.url}/v1/traces` },
        redaction: { denylist: [targetHost] },
        serviceName: 'test',
      }),
    ).pipe(Layer.provideMerge(FetchHttpClient.layer));
    await engineOver(providers).deploy(Thing('t', { name: 'x' }));
    expect(otlp.sawText('SECRET123')).toBe(false);
    expect(otlp.sawText('sekrit')).toBe(false);
    expect(otlp.sawText('http.request.header')).toBe(false);
    expect(otlp.sawText(targetHost)).toBe(false);
    expect(otlp.sawText('<redacted>')).toBe(true);
  });

  test('redteam PR 302 items 2+3: a FAILED provider call no longer leaks the query secret or denylisted segments via exception/status', async () => {
    const otlp = collector();
    const targetUrl = notFound();
    const host = new URL(targetUrl).hostname;
    const secretUrl = `${targetUrl}/secret-site-abc123/probe?token=SECRET123`;
    const failingProvider = Provider.succeed(Thing, {
      read: () => Effect.succeed(undefined),
      reconcile: () =>
        Effect.gen(function* () {
          const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
          const response = yield* client.execute(HttpClientRequest.get(secretUrl));
          yield* response.text;
          return { name: 'x' };
        }).pipe(Effect.withSpan('rt.provider-call')),
      delete: () => Effect.void,
    });
    const providers = Layer.mergeAll(
      failingProvider,
      telemetryLayer({
        endpoints: { traces: `${otlp.url}/v1/traces` },
        redaction: { denylist: [host, 'secret-site-abc123'] },
        serviceName: 'rt',
      }),
    ).pipe(Layer.provideMerge(FetchHttpClient.layer));
    await engineOver(providers)
      .deploy(Thing('t', { name: 'x' }))
      .catch(() => undefined);
    // Redteam measured this leaking via `exception.message`/`status.message`, computed from the exit's
    // Cause at export time — after `wrapTracer`'s own hooks already ran. `redactedSerialization`
    // (redact-serialization.ts) is the fix: it scrubs the wire-format `TraceData` one level deeper.
    expect(otlp.sawText('SECRET123')).toBe(false);
    expect(otlp.sawText('secret-site-abc123')).toBe(false);
    expect(otlp.sawText(`${host}:`)).toBe(false);
  });

  test('redteam PR 302 items 2+3: a log line inside a span no longer leaks via the span event name', async () => {
    const otlp = collector();
    const secretUrl = 'http://private.example.test/secret-site-abc123/x?token=SECRET123';
    const loggingProvider = Provider.succeed(Thing, {
      read: () => Effect.succeed(undefined),
      reconcile: () =>
        Effect.logWarning(`calling ${secretUrl}`).pipe(
          Effect.as({ name: 'x' }),
          Effect.withSpan('rt.logging'),
        ),
      delete: () => Effect.void,
    });
    const providers = Layer.mergeAll(
      loggingProvider,
      telemetryLayer({
        endpoints: { traces: `${otlp.url}/v1/traces` },
        redaction: { denylist: ['private.example.test', 'secret-site-abc123'] },
        serviceName: 'rt',
      }),
    );
    await engineOver(providers).deploy(Thing('t', { name: 'x' }));
    // effect's default `tracerLogger` turns this into a span EVENT whose NAME is the log message —
    // `wrapTracer.event()` redacts the attributes but passed the name straight through before this fix.
    expect(otlp.sawText('SECRET123')).toBe(false);
    expect(otlp.sawText('secret-site-abc123')).toBe(false);
  });
});
