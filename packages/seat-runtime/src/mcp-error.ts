/**
 * `mcpToolkit`'s typed failure, and the one place an MCP server's address is spelled for a
 * message or a span.
 *
 * ⛔ THE ADDRESS IS ORIGIN AND PATH ONLY. A query string is where a token lands when a server
 *   wants one there, and the headers a caller passes are bearer credentials: neither may reach
 *   an error message, a log line or a span attribute. Headers are never read here at all.
 */
/** Which call failed. `connect` covers the transport and the `initialize` handshake. */
export type McpOperation = 'connect' | 'listTools' | 'listResources' | 'readResource';

/** A server address safe to print: `https://host:port/path`, no credentials, query or fragment. */
export function serverLabel(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

/** The message of whatever a promise rejected with; an SDK `McpError` carries the JSON-RPC text. */
export function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The connection, a listing or a resource read failed.
 *
 * ★ A PLAIN `Error` WITH A `_tag`, NOT `Data.TaggedError`. `class X extends Data.TaggedError(…)<…>`
 *   is TS9021 under `isolatedDeclarations` ("extends clause can't contain an expression"; measured
 *   2026-09-15, see packages/alchemy/tsconfig.json), and this package keeps that flag on. The
 *   `_tag` is all `Effect.catchTag('McpToolkitError', …)` reads.
 */
export class McpToolkitError extends Error {
  readonly _tag = 'McpToolkitError' as const;
  readonly operation: McpOperation;
  /** `serverLabel` of the server: never a header, never a query string. */
  readonly server: string;

  constructor(fields: {
    readonly operation: McpOperation;
    readonly server: string;
    /** What the SDK threw: an `McpError` (a JSON-RPC error), a `StreamableHTTPError`, a fetch failure. */
    readonly cause: unknown;
  }) {
    super(
      `MCP ${fields.operation} against ${fields.server} failed: ${describeCause(fields.cause)}`,
      { cause: fields.cause },
    );
    this.name = 'McpToolkitError';
    this.operation = fields.operation;
    this.server = fields.server;
  }
}
