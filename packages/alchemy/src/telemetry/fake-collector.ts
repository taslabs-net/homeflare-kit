/**
 * A fake OTLP/HTTP collector for the tests beside it — `Bun.serve` on an ephemeral 127.0.0.1 port,
 * answering every POST with 200 and recording each request's path, headers and raw body bytes.
 *
 * ⛔ TEST-ONLY, and no live call ever leaves this process: nothing here reaches a real Victoria
 *   endpoint, satisfying the workflow's "no live calls to Victoria from tests" rule. A consumer's
 *   own integration test points `telemetryLayer` at ITS running Victoria; this file exists so this
 *   package's tests never need one.
 * ★ 200 UNCONDITIONALLY. `OtlpExporter.make` treats any non-2xx as a transient failure and retries
 *   three times with backoff (OtlpExporter.ts `policy`/`retryTransient`) — a fake that ever answered
 *   with an error would make a test wait through that retry schedule for no reason.
 * ⛔ RAW BYTES, NOT PARSED JSON (redteam PR 302 CRITICAL item 1, 2026-09-26): `telemetryLayer` now
 *   sends `OtlpSerialization.layerProtobuf`, not JSON, so there is no body to `JSON.parse`. `sawText`
 *   below is what every test needing to inspect content uses instead — it works unchanged for either
 *   encoding, since protobuf's string fields are raw UTF-8 with no escaping: a leaked literal (a
 *   secret, a span name, `<redacted>`) always appears as a contiguous byte run in the raw body,
 *   exactly like it would in JSON, with no OTLP protobuf decoder needed to find it.
 */
export interface CollectedRequest {
  readonly path: string;
  readonly headers: Headers;
  readonly raw: Uint8Array;
}

export interface FakeCollector {
  readonly url: string;
  readonly requests: CollectedRequest[];
  /** `requests` filtered to POSTs at exactly this path (e.g. `/v1/traces`). */
  at(path: string): CollectedRequest[];
  /** True when `text`'s bytes appear anywhere in ANY collected request's raw body. ASCII text (a
   * secret, a hostname, `<redacted>`) decodes to itself regardless of what surrounds it in an
   * otherwise-binary protobuf buffer — see this file's own header for why that's sound. */
  sawText(text: string): boolean;
  stop(): void;
}

const rawTextDecoder = new TextDecoder('utf-8', { fatal: false });

export const fakeCollector = (): FakeCollector => {
  const requests: CollectedRequest[] = [];
  const server = Bun.serve({
    fetch: async (request) => {
      const url = new URL(request.url);
      const raw = new Uint8Array(await request.arrayBuffer());
      requests.push({ headers: request.headers, path: url.pathname, raw });
      return new Response('{}', { headers: { 'content-type': 'application/json' }, status: 200 });
    },
    hostname: '127.0.0.1',
    port: 0,
  });
  return {
    at: (path) => requests.filter((request) => request.path === path),
    requests,
    sawText: (text) =>
      requests.some((request) => rawTextDecoder.decode(request.raw).includes(text)),
    stop: () => void server.stop(true),
    url: `http://127.0.0.1:${String(server.port ?? 0)}`,
  };
};
