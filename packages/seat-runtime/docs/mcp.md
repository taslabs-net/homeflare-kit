# `mcpToolkit`: behaviour, limits and measurements

The detail behind the [README](../README.md#mcptoolkit)'s section, kept here so the README
stays under its 200-line cap.

The official MCP SDK `Client` over Streamable HTTP; each MCP tool is a `Tool.dynamic` carrying
the server's own JSON Schema. It needs a `Scope`: the connection closes with it.

- **A tool failure goes back to the model**, not out of the run: an `isError` result, a JSON-RPC
  error (bad arguments, unknown tool) and a call that never completed are all the tool's result.
  Connecting and listing fail with `McpToolkitError` (`_tag`, `operation`, `server`), whose message
  holds the origin and path only, and whose `cause` is a scrubbed copy: never the headers or the
  query string (under Bun a refused fetch's own `path` field is the full URL; tests/printed.ts).
  A query value or header value the server **echoes on its own** is redacted too (6 characters and
  up); one the server transforms (hashed, base64) or one shorter than that is not. That covers
  the text of a failed tool call the model reads, an `isError` result included; a **successful**
  result is the tool's payload and is delivered verbatim.
- **Results are strings.** Text blocks verbatim; an image, audio or blob becomes a one-line marker,
  never its bytes; an empty result reads `(no content)`.
- ⚠️ The tool list is a **snapshot** at connect time. Names are passed through unchanged: an
  OpenAI-shaped API takes `[A-Za-z0-9_-]{1,64}`, so a server that names a tool with a dot is not
  renamed here (not measured through LiteLLM's MCP gateway).
- 🔴 **compat rc.115 cannot decode a tool call for a `Tool.dynamic` alone** (measured 2026-09-29:
  `UnsupportedSchemaError: Root JSON Schema must have type "object"`; rc.118 fixed it). The
  workaround in `src/mcp-tool.ts` costs two things: an argument the server's schema **does not
  declare is dropped**, and a tool that declares no properties takes no arguments. (An explicit
  `null` on an optional argument arrives as `null`: tests/mcp-arguments.test.ts, end to end.)
- **`connectTimeoutMs`** (default 15 000; a finite number above 0 and at most `2 ** 31 - 1`, else a
  `RangeError` defect) bounds the whole handshake (`initialize` and `notifications/initialized`) and
  each `tools/list` page read at startup: per request, not a total. `listResources`, `readResource`
  and tool calls keep the SDK's 60 s per request. All of it is interruptible.
- **A failed `mcpToolkit` leaves nothing behind**, wherever it fails: the handshake, the
  `tools/list` (a JSON-RPC error, a page held past `connectTimeoutMs`) or a caller's interruption.
  The client's finalizer is registered in your scope only once the whole toolkit is built, and each
  step closes the client if it fails, so `Effect.retry` around `mcpToolkit` does not pile up
  clients, sessions or sockets (tests/mcp-startup.test.ts, tests/mcp-list-failure.test.ts: the
  scope stays `Empty` and the server holds no open stream or listing).
- `listResources` is empty when the server does not advertise resources; `readResource` fails
  with `McpToolkitError` for an unknown URI. A workerd deployment is untested (the SDK's default
  validator is `ajv`, which needs `new Function`).
