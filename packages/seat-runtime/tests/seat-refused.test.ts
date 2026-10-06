/**
 * The refused forced turn through the REAL provider layer: `SeatModel` (compat rc.115) against a
 * LiteLLM stand-in that answers every chat call with a tool call, tools offered or not.
 *
 * 🔴 WHY THIS IS NOT tests/rounds.test.ts (review of PR 328, on the round 2 fix). That file's
 *   scripted model hands the SDK a tool-call part itself, and the SDK rejects it as
 *   `InvalidOutputError`. compat rejects the same reply EARLIER, while it maps it, as
 *   `ToolNotFoundError` ("Tool ... not found. Available tools: none"), so a fix that caught only
 *   `InvalidOutputError` passed every test and still failed the run for the provider this package
 *   ships. Measured: 3 model calls, tools offered [true, true, false], then `success: false`.
 * ⛔ 127.0.0.1, never Bun's wildcard default (tests/loopback-servers.test.ts scans for it).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Cause, Effect, Exit, Layer, Schema } from 'effect';
import { Chat, Tool, Toolkit } from 'effect/ai';
import { SeatModel, runRounds } from '../src/index.ts';
import { type Stub, startStub } from './stub.ts';

const ReadFact = Tool.make('read_fact', {
  description: 'read one fact',
  parameters: Schema.Struct({ key: Schema.String }),
  success: Schema.String,
});
const kit = Toolkit.make(ReadFact);

let llm: Stub;
let exit: Exit.Exit<{ rounds: number; capped: boolean; unanswered: boolean }, unknown>;
let toolCalls: string[];

beforeAll(async () => {
  llm = startStub({ alwaysTool: true, stubborn: true });
  toolCalls = [];
  const handlers = kit.toLayer({
    read_fact: ({ key }) => Effect.sync(() => (toolCalls.push(key), `fact:${key}`)),
  });
  const model = SeatModel.layer({
    model: 'cf-code',
    apiUrl: `${llm.origin}/v1`,
    apiKey: 'sk-seat-test-value',
    tags: ['seat:refused'],
  });
  const program = Effect.gen(function* () {
    const toolkit = yield* kit;
    const chat = yield* Chat.fromPrompt('use the tool');
    const { rounds, capped, unanswered } = yield* runRounds({ chat, toolkit, maxRounds: 2 });
    return { rounds, capped, unanswered };
  }).pipe(Effect.provide(Layer.mergeAll(handlers, model)));
  exit = await Effect.runPromiseExit(program);
});
afterAll(() => llm.stop());

describe('a provider that still asks for a tool on the forced turn', () => {
  test('ends the run as capped and unanswered, not as a failure', () => {
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause));
    // `rounds` counts the turns that returned: the refused forced turn did not.
    expect(exit.value).toEqual({ rounds: 2, capped: true, unanswered: true });
  });

  test('the forced call was made (tools offered, offered, then none) and its tool never ran', () => {
    const bodies = llm.at('/v1/chat/completions').map((request) => request.json ?? {});
    expect(bodies.map((body) => 'tools' in body)).toEqual([true, true, false]);
    expect(toolCalls).toEqual(['a', 'a']);
  });
});
