/**
 * What an MCP server RECEIVES when the model asks for a tool, end to end: a model reply from a
 * LiteLLM stub, compat's real tool-call normalisation, the toolkit's decode, the SDK's
 * `tools/call`, and the arguments the server read off the wire.
 *
 * ★ WHY NOT `Schema.decodeUnknownEffect(tool.parametersSchema)` (tests/mcp-tool.test.ts). compat
 *   does not decode with that schema: it runs the params through the OpenAI structured-output
 *   codec first, and that codec reads `null` on an optional key as ABSENT. A test of the schema
 *   alone passed while an explicit `null` never reached the server (review of PR 328, measured
 *   2026-09-29). Only the whole path says what arrives.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { Chat } from 'effect/ai';
import { SeatModel, mcpToolkit, runRounds } from '../src/index.ts';
import { type McpStub, startMcpStub } from './mcp-stub.ts';
import { type Stub, startStub } from './stub.ts';

let mcp: McpStub;
beforeAll(() => {
  mcp = startMcpStub({ issues: true });
});
afterAll(() => mcp.stop());

type Message = { readonly role: string; readonly content?: unknown };

/** One seat run in which the model asks for `update_issue` with exactly `args`, then answers. */
async function ask(args: string): Promise<{
  /** The `arguments` of every `tools/call` the MCP server received. */
  readonly arrived: unknown[];
  /** The `tool` messages the model was sent back. */
  readonly toolMessages: string[];
}> {
  const llm: Stub = startStub({ toolCall: { name: 'update_issue', arguments: args } });
  const before = mcp.seen.length;
  try {
    const model = SeatModel.layer({
      model: 'cf-code',
      apiUrl: `${llm.origin}/v1`,
      apiKey: 'sk-seat-test-value',
      tags: ['seat:arguments'],
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { toolkit } = yield* mcpToolkit(mcp.url);
          const chat = yield* Chat.fromPrompt('update the issue');
          return yield* runRounds({ chat, toolkit, maxRounds: 3 });
        }),
      ).pipe(Effect.orDie, Effect.provide(model)),
    );
    const last = llm.at('/v1/chat/completions').at(-1)?.json ?? {};
    return {
      arrived: mcp.seen
        .slice(before)
        .filter((request) => request.method === 'tools/call')
        .map((request) => request.arguments),
      toolMessages: ((last['messages'] ?? []) as Message[])
        .filter((message) => message.role === 'tool')
        .map((message) => JSON.stringify(message.content)),
    };
  } finally {
    llm.stop();
  }
}

describe('what reaches the server', () => {
  test('an explicit null on an optional argument arrives as null, not as an absent key', async () => {
    const { arrived } = await ask('{"id":"ISS-1","assignee":null}');
    expect(arrived).toEqual([{ id: 'ISS-1', assignee: null }]);
    // `toEqual` treats a missing key like `undefined`: say it outright.
    expect(Object.hasOwn(arrived[0] as object, 'assignee')).toBe(true);
  });

  test('an omitted optional argument stays omitted', async () => {
    const { arrived } = await ask('{"id":"ISS-1"}');
    expect(arrived).toEqual([{ id: 'ISS-1' }]);
    expect(Object.hasOwn(arrived[0] as object, 'assignee')).toBe(false);
  });

  test('a value on an optional argument arrives as sent', async () => {
    const { arrived } = await ask('{"id":"ISS-1","assignee":"tim"}');
    expect(arrived).toEqual([{ id: 'ISS-1', assignee: 'tim' }]);
  });

  test('⚠️ an argument the server’s schema does not declare is dropped (the documented cost)', async () => {
    const { arrived } = await ask('{"id":"ISS-1","assignee":null,"undeclared":true}');
    expect(arrived).toEqual([{ id: 'ISS-1', assignee: null }]);
  });

  test('a missing required argument never reaches the server, and the model is told', async () => {
    const { arrived, toolMessages } = await ask('{"assignee":null}');
    expect(arrived).toEqual([]);
    const told = toolMessages.join(' ');
    expect(told).toContain('ToolParameterValidationError');
    expect(told).toContain('Missing key');
  });
});
