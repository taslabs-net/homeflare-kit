/**
 * `mcpToolkit`'s typed failure, and the one place an MCP server's address is spelled for a
 * message or a span.
 *
 * ⛔ THE ADDRESS IS ORIGIN AND PATH ONLY. A query string is where a token lands when a server
 *   wants one there, and the headers a caller passes are bearer credentials: neither may reach
 *   an error message, a log line or a span attribute. Headers are never read here at all.
 * 🔴 THE `cause` IS A COPY, NEVER THE ORIGINAL. Measured 2026-09-29 (review of PR 328): under Bun a
 *   refused fetch is a `TypeError` whose own `path` field is the FULL URL, query string included,
 *   so attaching it as `cause` printed the token through `Bun.inspect`, `console.error`, an
 *   uncaught rejection and the default `Effect.logError` — while `error.message` was clean, which
 *   is all the first tests looked at. `scrubCause` rebuilds the chain from name, message, stack
 *   and a string or numeric `code` only, so no other field (`path`, `url`, `data`, `body`) is
 *   carried, and `redactor` takes the query string, fragment and password out of what remains.
 *   The price: `cause instanceof McpError` no longer holds; read `cause.code` instead.
 */
/** Which call failed. `connect` covers the transport and the `initialize` handshake. */
export type McpOperation = 'connect' | 'listTools' | 'listResources' | 'readResource';

/** A server address safe to print: `https://host:port/path`, no credentials, query or fragment. */
export function serverLabel(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

/** Text with a server's query string, fragment and password taken out of it. */
export type Redact = (text: string) => string;

/**
 * A `Redact` for one server address. The whole URL becomes `serverLabel` and any bare query
 * string, fragment or password left over becomes `[redacted]`: a server can echo the address
 * back in an error body, and a fetch failure can print it.
 */
export function redactor(url: URL): Redact {
  const label = serverLabel(url);
  const secrets = [
    url.search.length > 1 ? url.search : '',
    url.hash.length > 1 ? url.hash : '',
    url.password,
  ].filter((secret) => secret !== '');
  return (text) => {
    let out = text.split(url.href).join(label);
    for (const secret of secrets) out = out.split(secret).join('[redacted]');
    return out;
  };
}

/** How many `cause` links `scrubCause` follows: a cycle or a deep chain ends here. */
const MAX_CAUSE_DEPTH = 5;

/**
 * A copy of `cause` that is safe to print. ⚠️ An allowlist, not a denylist: an Error is rebuilt
 * from its name, message, stack and `code` (a string or number) and its own `cause`, each run
 * through `redact`; every other own field is left behind, whatever it is called. See the header.
 */
export function scrubCause(cause: unknown, redact: Redact, depth = 0): unknown {
  if (!(cause instanceof Error)) return redact(String(cause));
  const inner = depth < MAX_CAUSE_DEPTH && cause.cause !== undefined;
  const copy = new Error(
    redact(cause.message),
    inner ? { cause: scrubCause(cause.cause, redact, depth + 1) } : undefined,
  );
  copy.name = redact(cause.name);
  if (typeof cause.stack === 'string') copy.stack = redact(cause.stack);
  const code: unknown = (cause as { code?: unknown }).code;
  if (typeof code === 'string') Object.assign(copy, { code: redact(code) });
  else if (typeof code === 'number') Object.assign(copy, { code });
  return copy;
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
    /**
     * What the SDK threw: an `McpError` (a JSON-RPC error), a `StreamableHTTPError`, a fetch
     * failure. Never stored as given: `cause` on the error is `scrubCause` of it.
     */
    readonly cause: unknown;
    /** `redactor` of the server's URL. Left out, only the structural scrub of `cause` applies. */
    readonly redact?: Redact | undefined;
  }) {
    const redact = fields.redact ?? ((text: string) => text);
    super(
      `MCP ${fields.operation} against ${fields.server} failed: ${redact(describeCause(fields.cause))}`,
      { cause: scrubCause(fields.cause, redact) },
    );
    this.name = 'McpToolkitError';
    this.operation = fields.operation;
    this.server = fields.server;
  }
}
