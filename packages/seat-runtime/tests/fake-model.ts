/**
 * A scripted `LanguageModel`, for the tests that are about the loop and not the wire: it
 * decides per call whether to ask for a tool or answer, and records what each call was sent
 * (how many tools, the tool choice, the roles already in the history).
 *
 * ★ `LanguageModel.make` is the provider hook itself, so what is recorded is exactly what
 *   compat would have been handed: `ProviderOptions.tools` empty means no `tools` on the wire.
 */
import { Effect, Layer, Stream } from 'effect';
import { AiError, LanguageModel } from 'effect/unstable/ai';

/** What one model call was handed. */
export type Sent = {
  readonly tools: number;
  readonly toolChoice: unknown;
  /** The roles in the prompt, in order: `user`, `assistant`, `tool`... */
  readonly roles: readonly string[];
};

const USAGE = { inputTokens: { total: 1 }, outputTokens: { total: 1 } };

const asksForTool = (id: string) =>
  [
    { type: 'tool-call', id, name: 'read_fact', params: { key: 'a' } },
    { type: 'finish', reason: 'tool-calls', usage: USAGE },
  ] as const;

const answers = (text: string) =>
  [
    { type: 'text', text },
    { type: 'finish', reason: 'stop', usage: USAGE },
  ] as const;

export type FakeModel = {
  readonly layer: Layer.Layer<LanguageModel.LanguageModel>;
  readonly sent: Sent[];
};

/**
 * @param asks  Whether call number `call` (1-based) asks for a tool; when it does not, the
 *              model answers. A call with NO tools offered can only answer, whatever `asks` says.
 * @param failAt Call number to fail with an `AiError`, instead.
 */
export function fakeModel(asks: (call: number) => boolean, failAt?: number): FakeModel {
  const sent: Sent[] = [];
  const layer = Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: (options) => {
        sent.push({
          tools: options.tools.length,
          toolChoice: options.toolChoice,
          roles: options.prompt.content.map((message) => message.role),
        });
        const call = sent.length;
        if (call === failAt) {
          return Effect.fail(
            AiError.make({
              module: 'fake-model',
              method: 'generateText',
              reason: new AiError.UnknownError({ description: 'scripted failure' }),
            }),
          );
        }
        const asking = options.tools.length > 0 && asks(call);
        return Effect.succeed(
          // Spread: `PartEncoded[]` is mutable, and the `as const` tuples above are not.
          [...(asking ? asksForTool(`call-${String(call)}`) : answers(`answer-${String(call)}`))],
        );
      },
      streamText: () => Stream.empty,
    }),
  );
  return { layer, sent };
}
