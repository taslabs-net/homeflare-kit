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

const spanNamesIn = (collector: FakeCollector, path: string): string[] =>
  collector.at(path).flatMap((request) => {
    const body = request.body as {
      resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: Array<{ name: string }> }> }>;
    };
    return (body.resourceSpans ?? []).flatMap((rs) =>
      (rs.scopeSpans ?? []).flatMap((ss) => (ss.spans ?? []).map((span) => span.name)),
    );
  });

let collectors: FakeCollector[] = [];
const collector = (): FakeCollector => {
  const c = fakeCollector();
  collectors.push(c);
  return c;
};
afterEach(() => {
  for (const c of collectors) c.stop();
  collectors = [];
});

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
    const names = spanNamesIn(otlp, '/v1/traces');
    // The provider's own span, the HttpClient client span it made, and alchemy's OWN engine
    // instrumentation (Apply.ts `instrumentLifecycle`/`apply`/`apply.resource`, Plan.ts
    // `plan.make`) — measured together in docs/telemetry-spike.md's run against beta.79.
    expect(names).toContain('probe.custom-span');
    expect(names).toContain('http.client GET');
    expect(names).toContain('provider.create');
    expect(names).toContain('apply');
    expect(names).toContain('apply.resource');
    expect(names).toContain('plan.make');
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
    const request = otlp.at('/v1/traces')[0];
    const attributes = JSON.stringify(request?.body);
    expect(attributes).not.toContain('SECRET123');
    expect(attributes).not.toContain('sekrit');
    expect(attributes).not.toContain('http.request.header');
    expect(attributes).not.toContain(targetHost);
    expect(attributes).toContain('<redacted>');
  });
});
