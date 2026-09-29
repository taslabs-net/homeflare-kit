/**
 * A broken forced-turn reply through the REAL provider layer must FAIL the run, not read as a refusal.
 *
 * 🔴 WHY (review of PR 328, round 4). The forced final turn catches a tool call nobody offered
 *   (`ToolNotFoundError` from compat, or `InvalidOutputError` from `LanguageModel`). compat raises
 *   `InvalidOutputError` too, from `OpenAiClient`, for a 200 with an empty, non-JSON, truncated or
 *   non-completion body and for a body stream that dies mid-read. Catching the reason without its
 *   module turned each of those into a successful run with `capped: true, unanswered: true`, while
 *   the docs promise that network and gateway failures still fail the run.
 * ⛔ 127.0.0.1, never Bun's wildcard default (tests/loopback-servers.test.ts scans for it).
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { Effect, Exit, Layer, Schema } from 'effect';
import { Chat, Tool, Toolkit } from 'effect/unstable/ai';
import { SeatModel, runRounds } from '../src/index.ts';
import { type Stub, startStub } from './stub.ts';

const ReadFact = Tool.make('read_fact', {
  description: 'read one fact',
  parameters: Schema.Struct({ key: Schema.String }),
  success: Schema.String,
});
const kit = Toolkit.make(ReadFact);
const stubs: Stub[] = [];
afterAll(() => {
  for (const stub of stubs) stub.stop();
});

const run = async (brokenForced: 'empty' | 'truncated' | 'html' | 'noChoices' | 'reset') => {
  const llm = startStub({ alwaysTool: true, brokenForced });
  stubs.push(llm);
  const handlers = kit.toLayer({ read_fact: ({ key }) => Effect.succeed(`fact:${key}`) });
  const model = SeatModel.layer({
    model: 'cf-code',
    apiUrl: `${llm.origin}/v1`,
    apiKey: 'sk-seat-test-value',
    tags: ['seat:broken-forced'],
  });
  const program = Effect.gen(function* () {
    const toolkit = yield* kit;
    const chat = yield* Chat.fromPrompt('use the tool');
    return yield* runRounds({ chat, toolkit, maxRounds: 2 });
  }).pipe(Effect.provide(Layer.mergeAll(handlers, model)));
  const exit = await Effect.runPromiseExit(program);
  const bodies = llm.at('/v1/chat/completions').map((request) => request.json ?? {});
  return { exit, toolsOffered: bodies.map((body) => 'tools' in body) };
};

describe('a forced turn that comes back broken fails the run', () => {
  for (const kind of ['empty', 'truncated', 'html', 'noChoices', 'reset'] as const) {
    test(`${kind}: a failure, after the forced call was made`, async () => {
      const { exit, toolsOffered } = await run(kind);
      expect(toolsOffered).toEqual([true, true, false]);
      expect(Exit.isFailure(exit)).toBe(true);
    });
  }
});
