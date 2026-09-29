# @homeflare/seat-runtime

The two layers every HomeFlare coding seat shares: an Effect AI **model** that talks to
LiteLLM the way the seats need, and **telemetry** that lands traces, logs and metrics in
the Victoria stack on CT100 from one environment block.

```sh
bun add @homeflare/seat-runtime effect@4.0.0-rc.115
```

⛔ **Pin the rc, and put `overrides` in YOUR root `package.json`.** `effect` is an exact peer
and `@effect/ai-openai-compat` an exact dependency, both `4.0.0-rc.115`. If your app also
uses `@effect/platform-bun`, add this to your own manifest, or a fresh install crashes:

```json
{ "overrides": { "effect": "4.0.0-rc.115", "@effect/platform-node-shared": "4.0.0-rc.115" } }
```

## Use it

```ts
import { Effect, Layer } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';
import { SeatModel, SeatObs } from '@homeflare/seat-runtime';

const model = SeatModel.layer({
  model: 'cf-code', // a LiteLLM alias
  apiUrl: 'http://127.0.0.1:4100/v1', // required; there is no host default
  apiKey: seatKey, // your per-seat LiteLLM virtual key; held Redacted
  tags: ['host:ct100', 'lane:cfcode', 'seat:cf-coding'], // -> x-litellm-tags
});

const program = LanguageModel.generateText({ prompt: 'ping' }).pipe(
  Effect.withSpan('seat.run'),
  Effect.provide(Layer.mergeAll(model, SeatObs.layer)),
);
```

### `SeatModel`

- `layer({ model, apiUrl, apiKey, tags, noCache?, metadata?, config? })` provides
  `LanguageModel` on the **chat-completions** wire. ⛔ Not `/responses`: that wire fails on
  cf-code with `missing field sequence_number` (landscape PR 165).
- `embeddingLayer({ model, dimensions, ... })` provides `EmbeddingModel` and
  `EmbeddingModel.Dimensions`. ⚠️ `dimensions` is reported, **not sent**: compat's own
  `OpenAiEmbeddingModel.model(name, { dimensions })` sends it, and a provider with no
  such parameter can refuse the call. Pass `config: { dimensions }` to send it on purpose.
- `clientLayer(options)` is the shared `OpenAiClient` both build on, for a caller that
  wants to compose its own model.

Every request, chat and embedding alike, is stamped by one `HttpClient` transform:

| what             | where     | why                                                                                                                                               |
| ---------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x-litellm-tags` | header    | spend-log attribution. Validated: printable ASCII, no comma or space.                                                                             |
| `cache`          | body      | `{"no-cache": true, "no-store": true}` unless `noCache: false`. The body field is what LiteLLM honours; `caching: false` and a header are no-ops. |
| `num_retries: 0` | body      | a seat retries in Effect, where an attempt is a span. Always set.                                                                                 |
| `metadata`       | body      | only when you pass it and the body has none. compat drops `metadata` itself (measured, `tests/stamp.test.ts`).                                    |
| `strict: false`  | each tool | compat sends `strict: true` by default (measured 2026-09-29); the seats never did. A caller's `config` wins.                                      |

⚠️ `noCache` defaults to **true**. LiteLLM caches every completion for every key, so a
repeated call returns the old answer at a tenth of the latency and reads as agreement.

### `SeatObs`

`SeatObs.layer` is `OtlpTracer`, `OtlpLogger` and `OtlpMetrics` `.layerFromConfig()` over
`fetch`, protobuf on the wire. With **no** environment it sends to CT100:

| signal  | default endpoint                                         |
| ------- | -------------------------------------------------------- |
| traces  | `http://10.100.1.4:10428/insert/opentelemetry/v1/traces` |
| logs    | `http://10.100.1.4:9428/insert/opentelemetry/v1/logs`    |
| metrics | `http://10.100.1.4:8428/opentelemetry/v1/metrics`        |

Exported as `SeatObs.CT100_ENDPOINTS`. **Verified 2026-09-29 by GET, no payload sent**: each
mounted path answers, an unmounted sibling answers `unsupported path requested`, and the
services' own counters carry `format="protobuf"` for traces and logs. End-to-end ingest from
this package is not measured against the live services; the tests use a stub.

⛔ **The defaults are what makes it emit at all.** `layerFromConfig` exports nothing, silently,
unless the environment names an exporter and an endpoint. The environment still wins: set
`OTEL_SERVICE_NAME` per seat, or a `service.name` in `OTEL_RESOURCE_ATTRIBUTES` (the default,
`SeatObs.DEFAULT_SERVICE_NAME`, is `seat-runtime`; Effect reads `OTEL_SERVICE_NAME` first, so
when both are set the variable wins), `OTEL_SDK_DISABLED=true` to
silence everything, `OTEL_TRACES_EXPORTER=none` for one signal, or a per-signal
`OTEL_EXPORTER_OTLP_<TRACES|LOGS|METRICS>_ENDPOINT`. A base `OTEL_EXPORTER_OTLP_ENDPOINT`
replaces all three defaults (Effect appends `/v1/<signal>`, which fits a collector, not
the Victoria paths). The Claude Code seats read the same names, so one block wires every seat.

Model calls made inside a span carry `traceparent` (asserted against the stub). ⚠️ Whether
LiteLLM continues that trace is a separate question: it had no trace callback on 2026-09-29 (scout), so the
trace stops at the gateway until one is added. Each signal flushes when the scope closes, and
a log POST exists only when something logged.

`VERSION` is the package's own version.

## The measured pairing

Measured 2026-09-29 (a scratch install, then this package's tests and smoke):

- ✅ `effect` rc.115 with `@effect/ai-openai-compat` rc.115: clean install, `tsc` 7.0.2 exit 0,
  and at runtime chat, a tool round, embeddings, three OTLP signals and `traceparent`.
- ⚠️ With `skipLibCheck: false`, compat's **own** `.d.ts` has 26 `TS2411` errors. Upstream's,
  not ours; keep `skipLibCheck: true`. `scripts/smoke.ts` allows exactly those and nothing else.
- ⚠️ compat beta.107 beside effect rc.115 also installed and passed the same small surface
  (the scout's `pairBeta`). Nothing wider was tried, so the rule stays **same exact rc**.
- 🔴 **rc.118 drops the `unstable/` prefix**: `effect/unstable/ai` becomes `effect/ai`. rc.116
  and rc.117 keep it. The estate is pinned at rc.115, so do not bump one package alone.
- 🔴 **`@effect/platform-node-shared` resolves to rc.118** under `@effect/platform-bun`
  rc.115 on a fresh install, and the process dies at import (`Cannot find module
effect/process/ChildProcess`). Only a **root** `overrides` fixes it. An `overrides` field in
  a workspace member's manifest, or in a tarball you install, is ignored (measured), which is
  why this package declares none. `scripts/smoke.ts` installs platform-bun beside it with the
  override above and asserts all three resolve to rc.115.

## What is not here

No round loop, no MCP toolkit (0.2), no Postgres or Valkey state (0.3), no retry policy: the
caller retries in Effect. Nothing reads a credential from disk or logs one.

## Development

```sh
bun run --filter @homeflare/seat-runtime types   # tsc --noEmit, scoped to this package
bun test packages/seat-runtime
bun run --filter @homeflare/seat-runtime smoke   # needs `build` first
```

## License

MIT
