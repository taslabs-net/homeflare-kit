/**
 * A fake OTLP/HTTP collector for the tests beside it — `Bun.serve` on an ephemeral 127.0.0.1 port,
 * answering every POST with 200 and recording each request's path, headers and parsed JSON body.
 *
 * ⛔ TEST-ONLY, and no live call ever leaves this process: nothing here reaches a real Victoria
 *   endpoint, satisfying the workflow's "no live calls to Victoria from tests" rule. A consumer's
 *   own integration test points `telemetryLayer` at ITS running Victoria; this file exists so this
 *   package's tests never need one.
 * ★ 200 UNCONDITIONALLY. `OtlpExporter.make` treats any non-2xx as a transient failure and retries
 *   three times with backoff (OtlpExporter.ts `policy`/`retryTransient`) — a fake that ever answered
 *   with an error would make a test wait through that retry schedule for no reason.
 */
export interface CollectedRequest {
  readonly path: string;
  readonly headers: Headers;
  /** OTLP/HTTP JSON body, parsed — `OtlpSerialization.layerJson` is what this module always uses. */
  readonly body: unknown;
}

export interface FakeCollector {
  readonly url: string;
  readonly requests: CollectedRequest[];
  /** `requests` filtered to POSTs at exactly this path (e.g. `/v1/traces`). */
  at(path: string): CollectedRequest[];
  stop(): void;
}

export const fakeCollector = (): FakeCollector => {
  const requests: CollectedRequest[] = [];
  const server = Bun.serve({
    fetch: async (request) => {
      const url = new URL(request.url);
      const text = await request.text();
      requests.push({
        body: text === '' ? undefined : (JSON.parse(text) as unknown),
        headers: request.headers,
        path: url.pathname,
      });
      return new Response('{}', { headers: { 'content-type': 'application/json' }, status: 200 });
    },
    hostname: '127.0.0.1',
    port: 0,
  });
  return {
    at: (path) => requests.filter((request) => request.path === path),
    requests,
    stop: () => void server.stop(true),
    url: `http://127.0.0.1:${String(server.port ?? 0)}`,
  };
};
