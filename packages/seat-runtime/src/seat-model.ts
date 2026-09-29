/**
 * LiteLLM as an Effect `LanguageModel` and `EmbeddingModel`, on the chat-completions wire.
 *
 * ★ ONE CLIENT SHAPE FOR EVERY SEAT. `@effect/ai-openai-compat` builds the HTTP client;
 *   this file adds only what LiteLLM needs to attribute and control a seat's calls (tags,
 *   the response cache, retries, metadata — see stamp.ts) and pins `strictJsonSchema: false`.
 * ⛔ THE COMPAT PACKAGE POSTS `/chat/completions` AND `/embeddings`, NOT `/responses`. The
 *   responses wire fails on cf-code with `missing field sequence_number` (landscape PR 165),
 *   so nothing here points at it.
 */
import { OpenAiClient, OpenAiEmbeddingModel, OpenAiLanguageModel } from '@effect/ai-openai-compat';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';
import * as EmbeddingModel from 'effect/unstable/ai/EmbeddingModel';
import type * as LanguageModel from 'effect/unstable/ai/LanguageModel';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import { joinTags, stampRequest } from './stamp.ts';

export type SeatClientOptions = {
  /** LiteLLM's OpenAI-compatible base, e.g. `http://127.0.0.1:4100/v1`. Required: no host default. */
  readonly apiUrl: string;
  /** A per-seat LiteLLM virtual key. Held `Redacted`; this package never logs or reads it from disk. */
  readonly apiKey: string | Redacted.Redacted<string>;
  /** Spend-log attribution, e.g. `['host:ct100', 'lane:cfcode', 'seat:cf-coding']`. */
  readonly tags: string | ReadonlyArray<string>;
  /**
   * Skip LiteLLM's response cache, read and write. Defaults to TRUE.
   * ⚠️ LiteLLM caches every completion for every key, so a seat that repeats a call gets the
   *   old answer back at a tenth of the latency — an agent loop would replay itself.
   */
  readonly noCache?: boolean | undefined;
  /** Written into the request body only when the body carries none (compat drops it). */
  readonly metadata?: Readonly<Record<string, string>> | undefined;
};

/** Compat's own per-model config (`temperature`, `max_output_tokens`, custom body keys). */
type ModelConfig = NonNullable<Parameters<typeof OpenAiLanguageModel.layer>[0]['config']>;
type EmbeddingConfig = NonNullable<Parameters<typeof OpenAiEmbeddingModel.layer>[0]['config']>;

export type SeatModelOptions = SeatClientOptions & {
  /** The LiteLLM alias, e.g. `cf-code`. */
  readonly model: string;
  readonly config?: ModelConfig | undefined;
};

export type SeatEmbeddingOptions = SeatClientOptions & {
  /** The LiteLLM alias, e.g. `embeddings`. */
  readonly model: string;
  /**
   * What `EmbeddingModel.Dimensions` reports to a vector store. NOT sent to LiteLLM.
   * ⚠️ compat's own `OpenAiEmbeddingModel.model(name, { dimensions })` puts the number in the
   *   request body too, and a provider that has no `dimensions` parameter (a llama.cpp bge-m3
   *   behind LiteLLM) can refuse it. Pass `config: { dimensions }` to send it deliberately.
   */
  readonly dimensions: number;
  readonly config?: EmbeddingConfig | undefined;
};

/** The client: bearer key, tag header, cache and retry fields, over `fetch`. */
export function clientLayer(options: SeatClientOptions): Layer.Layer<OpenAiClient.OpenAiClient> {
  const stamp = {
    tags: joinTags(options.tags),
    noCache: options.noCache ?? true,
    metadata: options.metadata,
  };
  return OpenAiClient.layer({
    apiKey: Redacted.isRedacted(options.apiKey) ? options.apiKey : Redacted.make(options.apiKey),
    apiUrl: options.apiUrl.replace(/\/$/, ''),
    transformClient: (http) =>
      HttpClient.mapRequest(http, (request) => stampRequest(request, stamp)),
  }).pipe(Layer.provide(FetchHttpClient.layer));
}

/** `LanguageModel` for one LiteLLM alias. */
export function layer(options: SeatModelOptions): Layer.Layer<LanguageModel.LanguageModel> {
  return OpenAiLanguageModel.layer({
    model: options.model,
    // ★ cf-review's default, and measured here 2026-09-29: compat sends `strict: true` on every
    //   tool schema unless told otherwise, which the seats' previous client never did; this
    //   sends `strict: false`. A caller's `config` wins.
    config: { strictJsonSchema: false, ...options.config },
  }).pipe(Layer.provide(clientLayer(options)));
}

/** `EmbeddingModel` (and its `Dimensions`) for one LiteLLM alias. */
export function embeddingLayer(
  options: SeatEmbeddingOptions,
): Layer.Layer<EmbeddingModel.EmbeddingModel | EmbeddingModel.Dimensions> {
  return Layer.merge(
    OpenAiEmbeddingModel.layer({ model: options.model, config: options.config }),
    Layer.succeed(EmbeddingModel.Dimensions, options.dimensions),
  ).pipe(Layer.provide(clientLayer(options)));
}
