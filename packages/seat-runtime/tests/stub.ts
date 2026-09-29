/**
 * A LiteLLM and Victoria stand-in on loopback: answers chat (text, then a tool call, then
 * text again once a tool result is in the history), answers embeddings, and records every
 * request — model calls and the three OTLP POSTs alike — with its headers.
 *
 * ★ Seeded from the scout's measured scratch (pair115/runtime.ts, 2026-09-29), which proved
 *   the same pairing against a stub answering chat, a tool round and embeddings and counting
 *   three OTLP POSTs. Two changes: the server binds 127.0.0.1 (tests/loopback-servers.test.ts
 *   forbids Bun's wildcard default), and it keeps headers, because `traceparent` is the point.
 */
export type Captured = {
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bytes: Uint8Array;
  /** The parsed JSON body of a model call; undefined for OTLP protobuf. */
  readonly json: Record<string, unknown> | undefined;
};

export type Stub = {
  /** `http://127.0.0.1:<port>` */
  readonly origin: string;
  readonly requests: Captured[];
  readonly at: (path: string) => Captured[];
  /** The per-signal OTLP endpoints, as the `OTEL_*` environment block spells them. */
  readonly otlpEnv: () => Record<string, string>;
  readonly stop: () => void;
};

/** The tool call a model reply asks for: `arguments` is the JSON text, exactly as a model sends it. */
export type StubToolCall = { readonly name: string; readonly arguments: string };

const DEFAULT_TOOL_CALL: StubToolCall = { name: 'read_fact', arguments: '{"key":"a"}' };

const toolCallReply = (call: StubToolCall) => ({
  role: 'assistant',
  content: null,
  tool_calls: [
    { id: 'c1', type: 'function', function: { name: call.name, arguments: call.arguments } },
  ],
});

function chatReply(
  body: Record<string, unknown>,
  alwaysTool: boolean,
  toolCall: StubToolCall,
  stubborn: boolean,
): Response {
  const tools = Array.isArray(body['tools']) && body['tools'].length > 0;
  const messages = Array.isArray(body['messages']) ? (body['messages'] as { role?: string }[]) : [];
  // ★ `alwaysTool` is a model that never stops asking: the round cap has something to cap. A
  //   request that offers no tools is still answered with text, as a real model must, unless
  //   `stubborn`: then it asks for the tool anyway, which is the refused forced turn.
  const wantsTool =
    stubborn || (tools && (alwaysTool || !messages.some((message) => message.role === 'tool')));
  return Response.json({
    id: 'stub-1',
    object: 'chat.completion',
    created: 1,
    model: body['model'],
    choices: [
      {
        index: 0,
        message: wantsTool ? toolCallReply(toolCall) : { role: 'assistant', content: 'pong' },
        finish_reason: wantsTool ? 'tool_calls' : 'stop',
      },
    ],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
}

function embeddingReply(body: Record<string, unknown>): Response {
  const input = Array.isArray(body['input']) ? body['input'] : [body['input']];
  return Response.json({
    object: 'list',
    model: body['model'],
    data: input.map((_, index) => ({ object: 'embedding', index, embedding: [0.1, 0.2, 0.3] })),
    usage: { prompt_tokens: input.length, total_tokens: input.length },
  });
}

export function startStub(options?: {
  readonly alwaysTool?: boolean;
  /** What the model asks for when it asks for a tool. Default: `read_fact {"key":"a"}`. */
  readonly toolCall?: StubToolCall;
  /**
   * Ask for the tool on EVERY request, even one that offers none: a gateway that invents a tool
   * for a history full of tool calls (review of PR 328), so the forced final turn is refused.
   */
  readonly stubborn?: boolean;
}): Stub {
  const requests: Captured[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const bytes = new Uint8Array(await request.arrayBuffer());
      const isModel = path === '/v1/chat/completions' || path === '/v1/embeddings';
      const json = isModel
        ? (JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>)
        : undefined;
      requests.push({ path, headers: Object.fromEntries(request.headers), bytes, json });
      if (path === '/v1/chat/completions' && json !== undefined)
        return chatReply(
          json,
          options?.alwaysTool === true,
          options?.toolCall ?? DEFAULT_TOOL_CALL,
          options?.stubborn === true,
        );
      if (path === '/v1/embeddings' && json !== undefined) return embeddingReply(json);
      if (path.includes('opentelemetry')) return new Response(null, { status: 200 });
      return new Response('not found', { status: 404 });
    },
  });
  const origin = `http://127.0.0.1:${String(server.port)}`;
  return {
    origin,
    requests,
    at: (path) => requests.filter((request) => request.path === path),
    otlpEnv: () => ({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${origin}/insert/opentelemetry/v1/traces`,
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${origin}/insert/opentelemetry/v1/logs`,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${origin}/opentelemetry/v1/metrics`,
    }),
    stop: () => void server.stop(true),
  };
}

/** Poll until `check` holds. ⚠️ OTLP exporters flush on a timer or at scope close, not inline. */
export async function until(check: () => boolean, what: string, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error(`timed out after ${String(ms)}ms waiting for ${what}`);
    await Bun.sleep(20);
  }
}
