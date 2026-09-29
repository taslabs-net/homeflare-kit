/**
 * `runRounds` against a scripted model: when the loop stops, what the forced final turn is
 * sent, and what the caller is told.
 */
import { describe, expect, test } from 'bun:test';
import { Cause, Effect, Exit, Layer, Schema } from 'effect';
import { Chat, Tool, Toolkit } from 'effect/unstable/ai';
import { type Round, runRounds } from '../src/index.ts';
import { type FakeModel, fakeModel } from './fake-model.ts';

const ReadFact = Tool.make('read_fact', {
  description: 'read one fact',
  parameters: Schema.Struct({ key: Schema.String }),
  success: Schema.String,
});
const kit = Toolkit.make(ReadFact);

/** One run: a fresh chat holding `go`, a handler that counts its calls, the scripted model. */
async function run(model: FakeModel, maxRounds: number) {
  const handled: string[] = [];
  const rounds: Array<Round<{ read_fact: typeof ReadFact }>> = [];
  const handlers = kit.toLayer({
    read_fact: ({ key }) => Effect.sync(() => (handled.push(key), `fact:${key}`)),
  });
  const program = Effect.gen(function* () {
    const toolkit = yield* kit;
    const chat = yield* Chat.fromPrompt('go');
    return yield* runRounds({
      chat,
      toolkit,
      maxRounds,
      onRound: (round) => Effect.sync(() => void rounds.push(round)),
    });
  }).pipe(Effect.provide(Layer.mergeAll(handlers, model.layer)));
  const exit = await Effect.runPromiseExit(program);
  return { exit, handled, rounds };
}

const success = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (!Exit.isSuccess(exit)) throw new Error(`expected success, got ${Cause.pretty(exit.cause)}`);
  return exit.value;
};

describe('the cap', () => {
  test('fires at maxRounds: three tool rounds, then one forced turn', async () => {
    const model = fakeModel(() => true); // never stops asking
    const { exit, handled, rounds } = await run(model, 3);
    const result = success(exit);

    expect(result.capped).toBe(true);
    expect(result.unanswered).toBe(false);
    expect(result.rounds).toBe(4);
    expect(result.response.text).toBe('answer-4');
    // The handler ran for the three tool rounds and never for the forced one.
    expect(handled).toEqual(['a', 'a', 'a']);
    expect(model.sent).toHaveLength(4);
    expect(rounds.map((r) => [r.round, r.forced])).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [4, true],
    ]);
  });

  test('a cap of one still gets its forced turn', async () => {
    const model = fakeModel(() => true);
    const { exit, handled } = await run(model, 1);
    expect(success(exit)).toMatchObject({ capped: true, rounds: 2 });
    expect(handled).toEqual(['a']);
  });
});

describe('the forced final turn', () => {
  test('has no toolkit and toolChoice none; the others offer the tool on auto', async () => {
    const model = fakeModel(() => true);
    await run(model, 2);

    expect(model.sent.map((s) => [s.tools, s.toolChoice])).toEqual([
      [1, 'auto'],
      [1, 'auto'],
      [0, 'none'],
    ]);
  });

  test('still sees the tool calls and results already in the history', async () => {
    const model = fakeModel(() => true);
    await run(model, 2);
    // user, then (assistant call, tool result) twice, all carried into the forced turn.
    expect(model.sent.at(-1)?.roles).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool']);
  });
});

describe('a forced turn the provider refuses', () => {
  // 🔴 A provider that still asks for a tool on the forced turn. The SDK cannot decode a tool
  //   call nobody offered, so the turn fails with `InvalidOutputError`; before this was handled
  //   it failed the whole run with every round already spent (review of PR 328, round 2).
  test('ends the run as capped and unanswered, with the last tool round as its response', async () => {
    const model = fakeModel(() => true, undefined, true);
    const { exit, handled, rounds } = await run(model, 3);
    const result = success(exit);

    expect(result).toMatchObject({ capped: true, unanswered: true, rounds: 3 });
    // No answer: the response is round 3's, a turn that asked for a tool, and that tool ran.
    expect(result.response.toolCalls).toHaveLength(1);
    expect(handled).toEqual(['a', 'a', 'a']);
    // The forced call WAS made (it is the refused one) and no more were.
    expect(model.sent.map((s) => [s.tools, s.toolChoice])).toEqual([
      [1, 'auto'],
      [1, 'auto'],
      [1, 'auto'],
      [0, 'none'],
    ]);
    // `onRound` and the counters speak only for turns that returned.
    expect(rounds.map((r) => r.forced)).toEqual([false, false, false]);
  });

  test('another failure of the forced turn still fails the run', async () => {
    const model = fakeModel(() => true, 4); // call 4 is the forced turn: a scripted AiError
    const { exit } = await run(model, 3);

    expect(Exit.isFailure(exit)).toBe(true);
    expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : '').toContain('scripted failure');
  });
});

describe('a run that finishes before the cap', () => {
  test('answering early is not capped and gets no forced turn', async () => {
    const model = fakeModel((call) => call < 2); // asks once, then answers
    const { exit, handled, rounds } = await run(model, 5);

    expect(success(exit)).toMatchObject({ capped: false, unanswered: false, rounds: 2 });
    expect(handled).toEqual(['a']);
    expect(model.sent.map((s) => s.tools)).toEqual([1, 1]);
    expect(rounds.map((r) => r.forced)).toEqual([false, false]);
  });

  test('answering on round maxRounds exactly does not fire the cap', async () => {
    const model = fakeModel((call) => call < 3); // asks twice, answers on the third
    const { exit } = await run(model, 3);
    expect(success(exit)).toMatchObject({ capped: false, rounds: 3 });
    expect(model.sent).toHaveLength(3);
  });

  test('a model that never asks for a tool ends after one round', async () => {
    const model = fakeModel(() => false);
    const { exit } = await run(model, 4);
    expect(success(exit)).toMatchObject({ capped: false, rounds: 1 });
  });
});

describe('failures', () => {
  test('a model error ends the run with that error, and no forced turn follows', async () => {
    const model = fakeModel(() => true, 2);
    const { exit } = await run(model, 5);

    expect(Exit.isFailure(exit)).toBe(true);
    const text = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : '';
    expect(text).toContain('scripted failure');
    expect(model.sent).toHaveLength(2);
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'maxRounds %p is a defect raised before any model call',
    async (maxRounds) => {
      const model = fakeModel(() => true);
      const { exit } = await run(model, maxRounds);

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const defect = exit.cause.reasons.find(Cause.isDieReason)?.defect;
        expect(defect).toBeInstanceOf(RangeError);
      }
      expect(model.sent).toHaveLength(0);
    },
  );
});
