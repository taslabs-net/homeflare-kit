/**
 * One MCP tool as an Effect AI dynamic tool: the server's own JSON Schema goes to the model,
 * and the tool call the model sends back decodes without losing its arguments.
 *
 * ★ `Tool.dynamic` WITH THE SERVER'S JSON SCHEMA IS THE RIGHT SHAPE (its docs name MCP tools
 *   discovered at runtime), and the model sees that schema verbatim.
 * 🔴 BUT @effect/ai-openai-compat rc.115 CANNOT DECODE A TOOL CALL FOR IT. Measured 2026-09-29
 *   (tests/seat-loop.test.ts, first run): the request goes out, and when the model's reply asks
 *   for the tool, `transformToolCallParams` runs the OpenAI structured-output codec over the
 *   tool's `parametersSchema` — `Schema.Unknown` in JSON-Schema mode — and fails the whole turn
 *   with `UnsupportedSchemaError: Root JSON Schema must have type "object" and must not use
 *   "anyOf"`. rc.118 fixed it upstream: it returns the raw params for a dynamic tool that has a
 *   `jsonSchema`. The estate is pinned at rc.115 and rc.118 drops the `unstable/` import prefix,
 *   so this file carries the workaround until the pin moves.
 * ★ THE WORKAROUND: keep `jsonSchema` (what the model is sent, and what `Tool.getJsonSchema`
 *   returns), and replace `parametersSchema` — what compat's codec and the Toolkit decode with —
 *   by an object schema of the DECLARED property names, each `Unknown`, decoded to `Unknown`
 *   with an ENCODE THAT IS FORBIDDEN. Every declared value passes through untouched and
 *   `required` is honoured, so a missing argument fails as a tool result the model can read
 *   instead of reaching the server.
 * 🔴 WHY THE ENCODE IS FORBIDDEN. compat's `transformToolCallParams` (OpenAiLanguageModel.js)
 *   decodes the model's params through the OpenAI structured-output codec and re-encodes them
 *   with `parametersSchema`, falling back to the params AS SENT when either step fails. That
 *   codec rewrites every optional property as nullable and reads `null` as ABSENT, so with a
 *   plain object schema an explicit `null` on an optional argument was deleted before the call.
 *   Measured 2026-09-29 (review of PR 328), end to end through `SeatModel` and `mcpToolkit` into
 *   an Effect `McpServer`: `update_issue {id, assignee: null}` (null unassigns, omitted leaves
 *   alone) reached the server as `{id}`, and the run ended 'done'. That normalisation exists for
 *   the codec's own JSON Schema, and the model here was sent the server's, where `null` is a
 *   value. Forbidding the encode makes the re-encode fail, so compat forwards the params as the
 *   model sent them: `null` arrives as `null` (pinned in tests/mcp-arguments.test.ts).
 * ⚠️ WHAT IT COSTS: a property the schema does not declare is DROPPED before the call
 *   (Effect's decoder ignores excess keys; v4 has no "preserve"), so a server that declares
 *   `additionalProperties: true` and relies on undeclared keys gets fewer than the model sent.
 *   And a tool that declares no properties takes no arguments: `Tool.EmptyParams` is the only
 *   root the codec accepts for it, and it rejects any key.
 * ⛔ REMOVE THIS WHEN THE PIN REACHES rc.118 or later: build the tool from `Tool.dynamic` alone.
 *   The clone below copies what `Tool`'s own `setParameters` copies (its prototype and own
 *   fields), so it depends on Effect's tool object layout; the end-to-end test is what fails
 *   first if a bump changes that.
 */
import type * as JsonSchema from 'effect/JsonSchema';
import * as Schema from 'effect/Schema';
import * as SchemaGetter from 'effect/SchemaGetter';
import * as Tool from 'effect/unstable/ai/Tool';

/** One dynamic tool per MCP tool: the server's JSON Schema in, text out, failures returned. */
export type McpTool = Tool.Dynamic<
  string,
  {
    readonly parameters: JsonSchema.JsonSchema;
    readonly success: typeof Schema.String;
    readonly failure: typeof Schema.String;
    readonly failureMode: 'return';
  }
>;

/** What `client.listTools()` gives for one tool, narrowed to what is used here. */
export type McpToolSpec = {
  readonly name: string;
  readonly description?: string | undefined;
  readonly inputSchema: JsonSchema.JsonSchema;
};

/** The workaround's `parametersSchema`: the declared property names, each passed through as-is, decode-only. */
export function declaredParameters(inputSchema: JsonSchema.JsonSchema): Schema.Constraint {
  const properties = inputSchema['properties'];
  const names =
    typeof properties === 'object' && properties !== null ? Object.keys(properties) : [];
  if (names.length === 0) return Tool.EmptyParams;
  const required = new Set(
    Array.isArray(inputSchema['required']) ? (inputSchema['required'] as unknown[]) : [],
  );
  const declared = Schema.Struct(
    Object.fromEntries(
      names.map((name) => [
        name,
        required.has(name) ? Schema.Unknown : Schema.optional(Schema.Unknown),
      ]),
    ),
  );
  return declared.pipe(
    Schema.decodeTo(Schema.Unknown, {
      decode: SchemaGetter.passthrough(),
      encode: SchemaGetter.forbiddenEncoding,
    }),
  );
}

export function mcpTool(spec: McpToolSpec): McpTool {
  const dynamic = Tool.dynamic(spec.name, {
    description: spec.description,
    parameters: spec.inputSchema,
    success: Schema.String,
    failure: Schema.String,
    failureMode: 'return',
  });
  return Object.assign(Object.create(Object.getPrototypeOf(dynamic)), dynamic, {
    parametersSchema: declaredParameters(spec.inputSchema),
  }) as McpTool;
}
