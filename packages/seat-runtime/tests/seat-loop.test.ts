/**
 * The whole seat, on loopback, in one run: `SeatModel` → a LiteLLM stub that never stops asking
 * for a tool, `mcpToolkit` → an Effect MCP server, `runRounds` between them with a cap of two.
 * What crosses each wire is what the assertions read.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import * as ConfigProvider from 'effect/ConfigProvider';
import { Chat } from 'effect/ai';
import { SeatModel, SeatObs, mcpToolkit, runRounds } from '../src/index.ts';
import { type McpStub, startMcpStub } from './mcp-stub.ts';
import { type Stub, startStub, until } from './stub.ts';

const TRACES = '/insert/opentelemetry/v1/traces';

type Message = { readonly role: string; readonly content?: unknown };
type WireTool = {
  readonly function: {
    readonly name: string;
    readonly strict?: unknown;
    readonly parameters?: { readonly properties?: { readonly key?: { readonly type?: string } } };
  };
};

let llm: Stub;
let mcp: McpStub;
let outcome: { rounds: number; capped: boolean; forced: boolean[] };

beforeAll(async () => {
  llm = startStub({ alwaysTool: true });
  mcp = startMcpStub();
  const model = SeatModel.layer({
    model: 'cf-code',
    apiUrl: `${llm.origin}/v1`,
    apiKey: 'sk-seat-test-value',
    tags: ['host:ct100', 'seat:loop'],
  });
  const obs = SeatObs.layer.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(llm.otlpEnv()))),
  );
  const forced: boolean[] = [];
  const program = Effect.gen(function* () {
    const { toolkit } = yield* mcpToolkit(mcp.url);
    const chat = yield* Chat.fromPrompt('use the tool');
    const result = yield* runRounds({
      chat,
      toolkit,
      maxRounds: 2,
      onRound: (round) => Effect.sync(() => void forced.push(round.forced)),
    });
    return { rounds: result.rounds, capped: result.capped, forced };
  }).pipe(Effect.orDie, Effect.provide(model), Effect.provide(obs));
  outcome = await Effect.runPromise(Effect.scoped(program));
  // The exporters flush when the scope closes.
  await until(() => llm.at(TRACES).length > 0, 'the trace export');
});
afterAll(async () => {
  llm.stop();
  await mcp.stop();
});

const chatBody = (index: number) => llm.at('/v1/chat/completions')[index]?.json ?? {};

describe('the loop over the wire', () => {
  test('two tool rounds and one forced turn: three model calls', () => {
    expect(outcome).toEqual({ rounds: 3, capped: true, forced: [false, false, true] });
    expect(llm.at('/v1/chat/completions')).toHaveLength(3);
  });

  test('the MCP tools reach the model as the server’s own schema, with strict OFF', () => {
    for (const index of [0, 1]) {
      const tools = (chatBody(index)['tools'] ?? []) as WireTool[];
      expect(tools.map((tool) => tool.function.name).sort()).toEqual(['boom', 'read_fact']);
      const readFact = tools.find((tool) => tool.function.name === 'read_fact');
      expect(readFact?.function.strict).toBe(false);
      expect(readFact?.function.parameters?.properties?.key?.type).toBe('string');
    }
  });

  test('the forced turn carries no tools and no tool_choice, and keeps the tool results', () => {
    const forced = chatBody(2);
    // ⛔ An OpenAI-shaped API refuses `tool_choice` with no `tools`: neither may be on the wire.
    expect('tools' in forced).toBe(false);
    expect('tool_choice' in forced).toBe(false);
    const toolMessages = ((forced['messages'] ?? []) as Message[]).filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);
    // What the MCP server answered, delivered to the model verbatim.
    expect(JSON.stringify(toolMessages[0]?.content)).toContain('fact:a');
  });

  test('the earlier rounds offered the tools on auto, not none', () => {
    expect(chatBody(0)['tool_choice']).not.toBe('none');
    expect(chatBody(1)['tool_choice']).not.toBe('none');
  });

  test('the MCP server saw one tools/call per tool round, and none for the forced turn', () => {
    expect(mcp.seen.filter((request) => request.method === 'tools/call')).toHaveLength(2);
  });
});

describe('observability', () => {
  test('the trace carries the round, the MCP call and the connect spans', () => {
    const body = new TextDecoder('latin1').decode(llm.at(TRACES)[0]?.bytes ?? new Uint8Array());
    for (const name of ['seat.round', 'seat.mcp.call_tool', 'seat.mcp.connect']) {
      expect(body).toContain(name);
    }
  });

  test('the cap is logged and counted', async () => {
    await until(
      () => llm.at('/insert/opentelemetry/v1/logs').length > 0,
      'the log export',
      2000,
    ).catch(() => undefined);
    const logs = new TextDecoder('latin1').decode(
      llm.at('/insert/opentelemetry/v1/logs')[0]?.bytes ?? new Uint8Array(),
    );
    const metrics = new TextDecoder('latin1').decode(
      llm.at('/opentelemetry/v1/metrics')[0]?.bytes ?? new Uint8Array(),
    );
    expect(logs).toContain('seat round cap reached');
    expect(metrics).toContain('seat_rounds_total');
    expect(metrics).toContain('seat_rounds_capped_total');
  });
});
