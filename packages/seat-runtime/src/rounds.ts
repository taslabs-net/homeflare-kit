/**
 * The one round loop every seat shares: model turn, tool results, model turn, until the model
 * stops asking for tools or the cap fires — and a cap that fires is followed by ONE more turn
 * with the toolkit taken away, so a run ends with an answer instead of a truncated transcript.
 *
 * ★ WHAT THE SDK DOES AND DOES NOT DO. `Chat.generateText` with a toolkit resolves the tool
 *   calls of ONE model turn and returns; it never re-prompts, and Effect AI ships no
 *   `maxRounds` or `stopWhen` (grep of LanguageModel.d.ts and Chat.d.ts, 2026-09-29). The
 *   documented multi-round agent is a `while` over `session.generateText({ prompt: [], toolkit })`
 *   (compat's ai-docs, 30_chat.ts). This file is that `while`, once, with the cap.
 * ⛔ THE CAP IS HARD AND FINITE. `maxRounds` must be a positive integer: `Infinity`, `0`, a
 *   fraction or `NaN` is a programming error and dies with a `RangeError` before any model
 *   call, because a loop a bad config can un-cap is a loop that spends until something else
 *   stops it (LiteLLM's budget hit the claude2 fleet that way, 2026-09-28).
 * ⚠️ THE FORCED TURN SENDS NO TOOLS. No toolkit, and `toolChoice: 'none'` stated anyway: the SDK
 *   already defaults `toolChoice` to `'none'` for a call with no toolkit (LanguageModel.js,
 *   `providerOptions`, measured by mutation 2026-09-29: dropping the option changed no test), so
 *   it is kept for what it says and for the `toolChoice` attribute on the turn's span. compat
 *   then sends neither `tools` nor `tool_choice` (prepareTools returns both undefined for an
 *   empty tool list, rc.115), because an OpenAI-shaped API refuses a `tool_choice` with no
 *   `tools`. The history still carries the earlier tool calls and results, and cf-code accepted
 *   exactly that: one live call through CT100's LiteLLM (:4100), 2026-09-29, a history of
 *   system, user, assistant tool call and tool result, no `tools`, `toolChoice: 'none'`, came
 *   back `finishReason: 'stop'` with text and no tool call. One sample, one alias.
 * ⚠️ `capped` MEANS THE MODEL STILL WANTED TOOLS after `maxRounds` tool rounds. A model that
 *   answers on round `maxRounds` exactly is `capped: false`: the cap did not fire.
 * 🔴 THE FORCED TURN CAN BE REFUSED, AND THEN THE RUN DOES NOT DIE OF IT. A provider that asks for
 *   a tool although none was offered (a gateway that adds a dummy tool for a history full of
 *   tool calls does exactly that) answers a turn the SDK cannot use, and the SDK says so with one
 *   of TWO `AiError` reasons, depending on WHO rejects the tool call:
 *   - `ToolNotFoundError`: @effect/ai-openai-compat (`SeatModel`'s provider) rejects it first,
 *     while it maps the reply (`transformToolCallParams`: "Tool ... not found. Available tools:
 *     none"). Measured 2026-09-29 (review of PR 328, of the round 2 fix), `SeatModel` against a loopback
 *     LiteLLM stand-in that answered every call with a tool call: 3 model calls, tools offered
 *     [true, true, false], then the whole run failed with every round already spent. Round 2's
 *     fix caught only the reason below and so did nothing for this provider.
 *   - `InvalidOutputError`: `LanguageModel.make`'s own decode of the provider's parts ("Expected
 *     ... text | reasoning ..."), reached by a provider that hands the SDK a tool-call part
 *     itself (the scripted model in tests/fake-model.ts).
 *   Either is caught: the result is `capped` and `unanswered`, its `response` is the LAST TOOL
 *   ROUND's (whose calls did run), `rounds` stays `maxRounds`, and a warning, a span error and
 *   `seat_rounds_unanswered_total` say what happened. Any OTHER failure of the forced turn
 *   (network, rate limit, a handler) still fails the run.
 */
import * as Effect from 'effect/Effect';
import * as Metric from 'effect/Metric';
import type * as Chat from 'effect/unstable/ai/Chat';
import type * as LanguageModel from 'effect/unstable/ai/LanguageModel';
import * as Prompt from 'effect/unstable/ai/Prompt';
import type * as Tool from 'effect/unstable/ai/Tool';
import type * as Toolkit from 'effect/unstable/ai/Toolkit';

/** Every model turn, forced or not. */
const roundsTotal = Metric.counter('seat_rounds_total', {
  description: 'Model turns taken by runRounds, the forced final turn included.',
});
/** Runs whose cap fired: the interesting number, because each one is an agent that did not finish. */
const roundsCapped = Metric.counter('seat_rounds_capped_total', {
  description: 'runRounds runs that hit maxRounds and were given a forced final turn.',
});

/** Runs whose forced final turn was refused: the model still asked for a tool. */
const roundsUnanswered = Metric.counter('seat_rounds_unanswered_total', {
  description: 'runRounds runs whose forced final turn came back as a tool call, not an answer.',
});

/**
 * A turn's response: with the toolkit, or the forced one without.
 * ⚠️ The two modes differ because the SDK's own types do: a call with a toolkit answers
 *   `'opaque'` tool parameters, a call without one answers the default `'decoded'`.
 */
type Response<Tools extends Record<string, Tool.Any>> =
  | LanguageModel.GenerateTextResponse<Tools, 'opaque'>
  | LanguageModel.GenerateTextResponse<{}, 'decoded'>;

/** One model turn, as `onRound` and the result see it. */
export type Round<Tools extends Record<string, Tool.Any>> = {
  /** 1-based. The forced final turn, when there is one, is `maxRounds + 1`. */
  readonly round: number;
  /** True only for the forced final turn: no toolkit, `toolChoice: 'none'`. */
  readonly forced: boolean;
  readonly response: Response<Tools>;
};

export type RoundsOptions<Tools extends Record<string, Tool.Any>> = {
  /**
   * The conversation, already holding the opening prompt (`Chat.fromPrompt`) or a resumed
   * history that ends in a user message or tool results. Every round sends an EMPTY prompt:
   * `Chat` appends the model's turn and its tool results to `history` itself.
   */
  readonly chat: Chat.Chat;
  /**
   * Tools WITH their handlers. A `Toolkit.make(...)` is an Effect that needs its handlers from
   * context: `yield*` it where they are provided, and pass the result. (Typing it as the
   * Effect would hide its requirements, which `generateText` itself cannot track either.)
   */
  readonly toolkit: Toolkit.WithHandler<Tools>;
  /** The most tool rounds allowed. A positive integer; see the header. */
  readonly maxRounds: number;
  /** After every model turn, the forced one included. Runs inside that turn's span. */
  readonly onRound?: ((round: Round<Tools>) => Effect.Effect<void>) | undefined;
};

export type RoundsResult<Tools extends Record<string, Tool.Any>> = {
  /** The last model turn: the answer, or the forced final turn when the cap fired. */
  readonly response: Response<Tools>;
  /** Model turns that returned, the forced one included when it did. */
  readonly rounds: number;
  /** The cap fired and `response` is the forced final turn (or see `unanswered`). */
  readonly capped: boolean;
  /**
   * The forced turn was refused (a provider that still asks for a tool) and `response` is the
   * last TOOL round's: it holds no answer, and its tool calls ran. Only ever true with `capped`;
   * `rounds` then counts the turns that returned, so it is `maxRounds`. See the header.
   */
  readonly unanswered: boolean;
};

/**
 * Run the loop. Fails with whatever a model turn fails with (`AiError`, a tool handler's own
 * failure); nothing is retried here — the caller wraps `Effect.retry` where it wants one.
 */
export function runRounds<Tools extends Record<string, Tool.Any>>(
  options: RoundsOptions<Tools>,
): Effect.Effect<
  RoundsResult<Tools>,
  LanguageModel.ExtractError<{ readonly toolkit: Toolkit.WithHandler<Tools> }>,
  | LanguageModel.LanguageModel
  | LanguageModel.ExtractServices<{ readonly toolkit: Toolkit.WithHandler<Tools> }>
> {
  const { chat, toolkit, maxRounds, onRound } = options;
  return Effect.gen(function* () {
    if (!Number.isInteger(maxRounds) || maxRounds < 1) {
      return yield* Effect.die(
        new RangeError(`runRounds: maxRounds must be a positive integer, got ${String(maxRounds)}`),
      );
    }
    const finish = (round: number, forced: boolean) =>
      Effect.fnUntraced(function* (response: Response<Tools>) {
        yield* Metric.update(roundsTotal, 1);
        yield* Effect.annotateCurrentSpan({ 'seat.tool_calls': response.toolCalls.length });
        if (onRound !== undefined) yield* onRound({ round, forced, response });
        return response;
      });
    const span = (round: number, forced: boolean) =>
      Effect.withSpan('seat.round', {
        attributes: { 'seat.round': round, 'seat.round.forced': forced },
      });

    const turn = (round: number) =>
      chat
        .generateText({ prompt: Prompt.empty, toolkit })
        .pipe(Effect.flatMap(finish(round, false)), span(round, false));

    let round = 1;
    let response: Response<Tools> = yield* turn(round);
    // ★ The exit test is the model's: no tool calls means it has answered.
    while (response.toolCalls.length > 0 && round < maxRounds) {
      round += 1;
      response = yield* turn(round);
    }
    if (response.toolCalls.length === 0) {
      return { response, rounds: round, capped: false, unanswered: false };
    }

    yield* Metric.update(roundsCapped, 1);
    yield* Effect.logWarning('seat round cap reached; forcing a final turn without tools', {
      maxRounds,
    });
    const forcedRound = maxRounds + 1;
    /** The forced turn came back as a tool call: counted and logged, and the run goes on. */
    const refused = () =>
      Effect.as(
        Effect.all([
          Metric.update(roundsUnanswered, 1),
          Effect.logWarning('seat forced final turn refused: the model still asked for a tool', {
            maxRounds,
          }),
        ]),
        undefined,
      );
    const forced = yield* chat.generateText({ prompt: Prompt.empty, toolChoice: 'none' }).pipe(
      Effect.flatMap(finish(forcedRound, true)),
      span(forcedRound, true),
      // ⚠️ Only the two reasons of a tool call nobody offered: see the header for who raises which.
      Effect.catchReasons('AiError', {
        InvalidOutputError: refused,
        ToolNotFoundError: refused,
      }),
    );
    return forced === undefined
      ? { response, rounds: maxRounds, capped: true, unanswered: true }
      : { response: forced, rounds: forcedRound, capped: true, unanswered: false };
  });
}
