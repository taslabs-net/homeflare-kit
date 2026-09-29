/**
 * Where SeatObs sends things when nothing, something or everything is configured, with no
 * network: the HTTP client's `fetch` is replaced, so the CT100 addresses are only ever
 * recorded, never dialled.
 *
 * ⛔ THE SILENT FAILURE THIS PINS. `layerFromConfig` exports NOTHING unless the environment
 *   names an exporter and an endpoint, so a seat that forgot its `OTEL_*` block would run
 *   green and be invisible. These tests are the proof the defaults make it emit anyway.
 */
import { describe, expect, test } from 'bun:test';
import { Effect, Layer, Metric } from 'effect';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { SeatObs } from '../src/index.ts';

type Seen = { readonly url: string; readonly body: string };

/**
 * Run one span, one log line and one counter; return what was POSTed where. `env` is a
 * record standing in for the environment, or `'process'` for the real `process.env`.
 */
async function post(env: Record<string, string> | 'process'): Promise<Seen[]> {
  const seen: Seen[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    // latin1 keeps every byte a char, so protobuf text fields stay searchable.
    const bytes = init?.body instanceof Uint8Array ? init.body : new Uint8Array();
    seen.push({ url: String(input), body: new TextDecoder('latin1').decode(bytes) });
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  const counter = Metric.counter('seat_config_probe_total');
  const program = Effect.gen(function* () {
    yield* Effect.log('config probe');
    yield* Metric.update(counter, 1);
  }).pipe(Effect.withSpan('seat.config-probe'));
  const withFetch = SeatObs.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fake)));
  const layer =
    env === 'process'
      ? withFetch
      : withFetch.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))));
  await Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(layer))));
  return seen;
}

const urls = (seen: Seen[]): string[] => seen.map((s) => s.url).sort();

/**
 * Run `body` with `process.env` holding exactly `set` among its `OTEL_*` keys, then put every
 * one of them back as it was.
 *
 * ⛔ WHY EVERY `OTEL_*` KEY IS CLEARED, NOT JUST THE ONE UNDER TEST. Effect reads a per-signal
 *   endpoint, `OTEL_SDK_DISABLED` and `OTEL_<SIGNAL>_EXPORTER` before the base variable, so a
 *   test that sets only the base URL still depends on whatever else the shell exported. The CT100
 *   Claude Code seats export all three per-signal endpoints in their `settings.json` `env`, and
 *   that reaches the Bash subprocess a builder runs the gate from.
 * ⚠️ The variables are process-wide and other files share the process, hence the `finally`.
 */
async function withOtelEnv<T>(set: Record<string, string>, body: () => Promise<T>): Promise<T> {
  const saved = Object.entries(process.env).filter(([name]) => name.startsWith('OTEL_'));
  for (const [name] of saved) delete process.env[name];
  Object.assign(process.env, set);
  try {
    return await body();
  } finally {
    for (const name of Object.keys(set)) delete process.env[name];
    for (const [name, value] of saved) if (value !== undefined) process.env[name] = value;
  }
}

describe('CT100 defaults', () => {
  test('the exact addresses, one per signal, with an empty environment', async () => {
    expect(SeatObs.CT100_ENDPOINTS).toEqual({
      traces: 'http://10.100.1.4:10428/insert/opentelemetry/v1/traces',
      logs: 'http://10.100.1.4:9428/insert/opentelemetry/v1/logs',
      metrics: 'http://10.100.1.4:8428/opentelemetry/v1/metrics',
    });
    expect(urls(await post({}))).toEqual(Object.values(SeatObs.CT100_ENDPOINTS).sort());
  });

  test('the service name defaults, and OTEL_SERVICE_NAME replaces it', async () => {
    const unnamed = (await post({})).find((s) => s.url.endsWith('/traces'));
    expect(unnamed?.body).toContain(SeatObs.DEFAULT_SERVICE_NAME);
    const named = (await post({ OTEL_SERVICE_NAME: 'cf-review' })).find((s) =>
      s.url.endsWith('/traces'),
    );
    expect(named?.body).toContain('cf-review');
    expect(named?.body).not.toContain(SeatObs.DEFAULT_SERVICE_NAME);
  });
});

describe('the environment wins', () => {
  test('a per-signal endpoint replaces only its own default', async () => {
    const seen = await post({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://collector.test/t' });
    expect(urls(seen)).toEqual(
      [
        'http://collector.test/t',
        SeatObs.CT100_ENDPOINTS.logs,
        SeatObs.CT100_ENDPOINTS.metrics,
      ].sort(),
    );
  });

  test('a base endpoint is not shadowed by the per-signal defaults', async () => {
    // ⚠️ Effect reads the per-signal variable first, so a per-signal default would have sent
    //   an operator's traces to CT100 while their base URL sat unused.
    const seen = await post({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.test:4318' });
    expect(urls(seen)).toEqual(
      [
        'http://collector.test:4318/v1/logs',
        'http://collector.test:4318/v1/metrics',
        'http://collector.test:4318/v1/traces',
      ].sort(),
    );
  });

  test('the real process environment is read the same way', async () => {
    // ⚠️ `fromEnvRecord` above is a stand-in; a deployed seat reads `process.env`.
    const seen = await withOtelEnv(
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.test:4318' },
      () => post('process'),
    );
    expect(urls(seen)).toEqual(
      [
        'http://collector.test:4318/v1/logs',
        'http://collector.test:4318/v1/metrics',
        'http://collector.test:4318/v1/traces',
      ].sort(),
    );
  });

  test('an ambient OTEL_* block does not leak into the process-environment case', async () => {
    // The CT100 seat shape: every per-signal endpoint and exporter, plus a disable switch, all
    // exported by the shell that runs the gate. None of it may change what the case above sees,
    // and every key must be back afterwards.
    const ambient = {
      OTEL_SDK_DISABLED: 'true',
      OTEL_TRACES_EXPORTER: 'none',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://ambient.test/t',
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://ambient.test/l',
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://ambient.test/m',
    };
    const inner = { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.test:4318' };
    const seen = await withOtelEnv(ambient, () => withOtelEnv(inner, () => post('process')));
    expect(urls(seen)).toEqual(
      [
        'http://collector.test:4318/v1/logs',
        'http://collector.test:4318/v1/metrics',
        'http://collector.test:4318/v1/traces',
      ].sort(),
    );
    await withOtelEnv(ambient, async () => {
      await withOtelEnv(inner, async () => undefined);
      for (const [name, value] of Object.entries(ambient)) expect(process.env[name]).toBe(value);
      expect(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    });
  });

  test('OTEL_SDK_DISABLED silences every signal', async () => {
    expect(await post({ OTEL_SDK_DISABLED: 'true' })).toEqual([]);
  });

  test('one exporter set to none silences only that signal', async () => {
    const seen = await post({ OTEL_TRACES_EXPORTER: 'none' });
    expect(urls(seen)).toEqual(
      [SeatObs.CT100_ENDPOINTS.logs, SeatObs.CT100_ENDPOINTS.metrics].sort(),
    );
  });
});
