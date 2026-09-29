/**
 * One seat run against the stub: a plain completion, a tool round (call, handler, result,
 * the follow-up turn carrying it), and an embedding, all inside one span, with the model
 * layers and the OTLP layer wired the way a consumer wires them.
 *
 * ★ ONE RUN, MANY ASSERTIONS. The exporters flush when the scope closes, so the three OTLP
 *   POSTs exist only after `runScenario` returns; model.test.ts and telemetry.test.ts both
 *   read this same run's record instead of each paying for a scope.
 */
import { Effect, Layer, Metric, Schema } from 'effect';
import * as ConfigProvider from 'effect/ConfigProvider';
import { Chat, EmbeddingModel, LanguageModel, Prompt, Tool, Toolkit } from 'effect/unstable/ai';
import { SeatModel, SeatObs } from '../src/index.ts';
import type { Stub } from './stub.ts';

/** A test value, not a credential: the assertion is that it never leaves in a payload. */
export const API_KEY = 'sk-seat-test-value';
export const TAGS: string[] = ['host:ct100', 'lane:cfcode', 'seat:cf-coding'];

const ReadFact = Tool.make('read_fact', {
  description: 'read one fact',
  parameters: Schema.Struct({ key: Schema.String }),
  success: Schema.String,
  failure: Schema.String,
  failureMode: 'return',
});
const toolkit = Toolkit.make(ReadFact);
const handlers = toolkit.toLayer({ read_fact: ({ key }) => Effect.succeed(`fact:${key}`) });

export type ScenarioResult = {
  /** The run span's trace id: every model call must carry it in `traceparent`. */
  readonly traceId: string;
  readonly text: string;
  readonly round1: { readonly calls: number; readonly results: number; readonly finish: string };
  readonly round2: { readonly text: string; readonly finish: string };
  readonly embedding: { readonly dims: number; readonly declared: number };
};

export async function runScenario(stub: Stub): Promise<ScenarioResult> {
  const model = SeatModel.layer({
    model: 'cf-code',
    apiUrl: `${stub.origin}/v1`,
    apiKey: API_KEY,
    tags: TAGS,
    metadata: { seat: 'cf-coding' },
  });
  const embeddings = SeatModel.embeddingLayer({
    model: 'embeddings',
    apiUrl: `${stub.origin}/v1/`,
    apiKey: API_KEY,
    tags: TAGS,
    metadata: { seat: 'cf-coding' },
    dimensions: 3,
  });
  // The stub's endpoints arrive as the environment a deployed seat would carry.
  const obs = SeatObs.layer.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(stub.otlpEnv()))),
  );
  const rounds = Metric.counter('seat_rounds_total');

  const program = Effect.gen(function* () {
    const span = yield* Effect.currentSpan;
    const plain = yield* LanguageModel.generateText({ prompt: 'ping' });
    // Two turns on one history: the second request must carry the tool result.
    const chat = yield* Chat.empty;
    const first = yield* chat.generateText({ prompt: 'use the tool', toolkit });
    const second = yield* chat.generateText({ prompt: Prompt.empty, toolkit });
    const embedded = yield* EmbeddingModel.EmbeddingModel.use((m) => m.embed('hello'));
    const declared = yield* EmbeddingModel.Dimensions;
    yield* Metric.update(rounds, 2);
    yield* Effect.log('seat run finished');
    return {
      traceId: span.traceId,
      text: plain.text,
      round1: {
        calls: first.toolCalls.length,
        results: first.toolResults.length,
        finish: first.finishReason,
      },
      round2: { text: second.text, finish: second.finishReason },
      embedding: { dims: embedded.vector.length, declared },
    };
  }).pipe(
    Effect.withSpan('seat.run'),
    Effect.provide(Layer.mergeAll(handlers, model, embeddings)),
    Effect.provide(obs),
  );
  return await Effect.runPromise(Effect.scoped(program));
}
