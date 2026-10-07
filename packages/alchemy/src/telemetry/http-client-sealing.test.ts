/**
 * The leak `layer.ts`'s own ★ describes: caddy's `admin-transport-scope.test.ts` measured that a
 * provider Layer merging its own `HttpClient.HttpClient` straight into its output can shadow a
 * sibling fetch-based provider's ambient client once both sit in the same `Layer.mergeAll`. This
 * file is that same test shape, for `telemetryLayer`'s own (real, `fetch`-backed) `FetchHttpClient`.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/http/HttpClient';
import * as HttpClientResponse from 'effect/http/HttpClientResponse';
import { engineOver } from '../verify/fake-engine.ts';
import { type FakeCollector, fakeCollector } from './fake-collector.ts';
import { telemetryLayer } from './layer.ts';

interface Probe extends Resource<'Test.TelemetrySealingProbe', { name: string }, { via: string }> {}
const Probe = Resource<Probe>('Test.TelemetrySealingProbe');

/** A sibling fetch-based provider (Forgejo, LiteLLM in the estate) — it just needs SOME
 * `HttpClient.HttpClient` in scope, and reports which one it got. */
const ProbeProvider = (vias: string[]) => {
  const hit = Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get('http://sibling.invalid/probe');
    vias.push(yield* response.text);
  });
  return Provider.succeed(Probe, {
    read: () => Effect.as(hit, undefined),
    reconcile: () => Effect.as(hit, { via: 'ambient' }),
    delete: () => Effect.void,
  });
};

/** Answers instantly and records that IT (not telemetry's own client) was the one asked. */
const labeledClient = (label: string, seen: string[]): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      seen.push(label);
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(label)));
    }),
  );

let otlp: FakeCollector | undefined;
afterEach(() => {
  otlp?.stop();
  otlp = undefined;
});

describe('telemetryLayer HttpClient sealing', () => {
  test("a sibling provider merged alongside it gets the AMBIENT client, never telemetry's own", async () => {
    otlp = fakeCollector();
    const vias: string[] = [];
    const ambient = labeledClient('ambient', vias);
    const engine = engineOver(
      Layer.mergeAll(
        ProbeProvider(vias),
        telemetryLayer({ endpoints: { traces: `${otlp.url}/v1/traces` }, serviceName: 'test' }),
      ).pipe(Layer.provideMerge(ambient)),
    );
    await engine.deploy(Probe('p', { name: 'sibling' }));
    expect(vias.length).toBeGreaterThan(0);
    expect(new Set(vias)).toEqual(new Set(['ambient']));
  });

  test("with no ambient client at all, the sibling fails rather than silently reaching telemetry's own", async () => {
    otlp = fakeCollector();
    const vias: string[] = [];
    // ★ No `ambient` layer this time. If `telemetryLayer`'s `FetchHttpClient` ever leaked into its
    //   own output, the sibling below would resolve it and this would succeed instead of throwing —
    //   exactly the failure mode docs/telemetry-spike.md's first run hit by accident before `ambient` was added.
    const engine = engineOver(
      Layer.mergeAll(
        ProbeProvider(vias),
        telemetryLayer({ endpoints: { traces: `${otlp.url}/v1/traces` }, serviceName: 'test' }),
      ),
    );
    await expect(engine.deploy(Probe('p', { name: 'sibling' }))).rejects.toThrow();
  });
});
