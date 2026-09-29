/**
 * The rc.115 workaround in src/mcp-tool.ts, pinned: the model still gets the server's own JSON
 * Schema, and the schema the SDK decodes tool calls with keeps every declared argument.
 * tests/seat-loop.test.ts is the end-to-end proof; these say exactly what the schema does.
 */
import { describe, expect, test } from 'bun:test';
import { Effect, Schema } from 'effect';
import { Tool } from 'effect/unstable/ai';
import * as OpenAiStructuredOutput from 'effect/unstable/ai/OpenAiStructuredOutput';
import { mcpTool } from '../src/mcp-tool.ts';

const SERVER_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'what to look for' },
    limit: { type: 'integer', minimum: 1 },
    filter: { type: 'object', properties: { tag: { type: 'string' } } },
  },
  required: ['query'],
  additionalProperties: false,
} as const;

const decode = (tool: ReturnType<typeof mcpTool>, input: unknown) =>
  Effect.runPromise(
    Schema.decodeUnknownEffect(tool.parametersSchema as Schema.Decoder<unknown>)(input).pipe(
      Effect.result,
    ),
  );

describe('what the model is sent', () => {
  test('the server’s JSON Schema, verbatim', () => {
    const tool = mcpTool({
      name: 'search',
      description: 'find things',
      inputSchema: SERVER_SCHEMA,
    });
    expect(Tool.getJsonSchema(tool)).toEqual(SERVER_SCHEMA);
    expect(Tool.getDescription(tool)).toBe('find things');
    expect(tool.name).toBe('search');
  });

  test('it is still a dynamic tool that returns its failures to the model', () => {
    const tool = mcpTool({ name: 'search', inputSchema: SERVER_SCHEMA });
    expect(Tool.isDynamic(tool)).toBe(true);
    expect(tool.failureMode).toBe('return');
  });
});

describe('what a tool call decodes to', () => {
  const tool = mcpTool({ name: 'search', inputSchema: SERVER_SCHEMA });

  test('every declared argument passes through untouched, nested values included', async () => {
    const args = { query: 'q', limit: 3, filter: { tag: 'x', deep: { a: [1, 2] } } };
    const result = await decode(tool, args);
    expect(result._tag).toBe('Success');
    expect(result._tag === 'Success' ? result.success : undefined).toEqual(args);
  });

  test('an optional argument may be absent', async () => {
    const result = await decode(tool, { query: 'q' });
    expect(result._tag === 'Success' ? result.success : undefined).toEqual({ query: 'q' });
  });

  test('a required argument may not: it fails as something the model can read', async () => {
    const result = await decode(tool, { limit: 3 });
    expect(result._tag).toBe('Failure');
    expect(result._tag === 'Failure' ? String(result.failure) : '').toContain('query');
  });

  test('⚠️ an undeclared argument is dropped, not forwarded', async () => {
    const result = await decode(tool, { query: 'q', undeclared: true });
    expect(result._tag === 'Success' ? result.success : undefined).toEqual({ query: 'q' });
  });

  test('a value that is not an object is refused', async () => {
    expect((await decode(tool, 'q'))._tag).toBe('Failure');
    expect((await decode(tool, null))._tag).toBe('Failure');
  });
});

describe('a tool that declares no properties', () => {
  const tool = mcpTool({ name: 'ping', inputSchema: { type: 'object' } });

  test('takes an empty object', async () => {
    expect((await decode(tool, {}))._tag).toBe('Success');
  });

  test('⚠️ and rejects any key: EmptyParams is the only root the codec accepts for it', async () => {
    expect((await decode(tool, { anything: 1 }))._tag).toBe('Failure');
  });
});

describe('the compat codec, which is the whole reason for the workaround', () => {
  // 🔴 rc.115 runs this over `parametersSchema` for every tool call the model makes, and throws
  //   for `Schema.Unknown`, which is what `Tool.dynamic` alone would leave there.
  test('accepts the declared-properties schema and the empty one', () => {
    for (const inputSchema of [SERVER_SCHEMA, { type: 'object' }]) {
      const tool = mcpTool({ name: 't', inputSchema });
      expect(() =>
        OpenAiStructuredOutput.toCodecOpenAI(tool.parametersSchema as never),
      ).not.toThrow();
    }
  });

  test('and does throw for Schema.Unknown, so the workaround is still needed', () => {
    expect(() => OpenAiStructuredOutput.toCodecOpenAI(Schema.Unknown as never)).toThrow(
      /Root JSON Schema must have type "object"/,
    );
  });
});
