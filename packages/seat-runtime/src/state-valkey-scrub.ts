/**
 * What a Valkey error may say once it has left the layer.
 *
 * 🔴 THE SERVER'S ERROR TEXT ECHOES THE ARGUMENTS OF THE CALL THAT FAILED. Measured 2026-09-29
 *   (Valkey 9.1.1, through `Bun.RedisClient`, with canary values):
 *     ERR unknown command 'JSON.SET', with args beginning with: 'seat:key-…' '$' '{"secret":…}'
 *     ERR unknown subcommand 'seat:key-…'. Try OBJECT HELP.
 *   Keys are seat data and values are whatever the seat stored, and Effect's `OtlpTracer` exports
 *   every FAILED span's error as `exception.message` and `exception.stacktrace` (with the whole
 *   `cause` chain, `includeCauseInStack: true`), so those two errors put a key and a value into
 *   the exported trace: the OTLP payload a Victoria service would receive held both (a wire test
 *   in tests/state-error-text.test.ts asserts it now does not). A `Logger` that prints a failed
 *   call does the same.
 * ★ SO THE ERROR THAT LEAVES THE LAYER IS A NEW `Error` WITH THE ARGUMENTS CUT OUT, and the
 *   original is not chained (a `cause` would carry its text straight back into the stack). Kept:
 *   Bun's `code` and `name`, and the server's own words up to the first quote that opens
 *   something other than the command that was sent. That keeps `NOPERM User seat has no
 *   permissions to run the 'flushall' command` whole (so `isPermissionDenied` and the wording are
 *   unchanged) and cuts `unknown command 'JSON.SET', with args beginning with: ` at the first
 *   argument, even when an argument holds a quote itself.
 * ⚠️ WHAT THIS DOES NOT COVER, said plainly: a server text that echoes an argument WITHOUT quotes,
 *   and the text a Lua script raises itself (`error(...)` comes back as `ERR user_script:1: <text>`;
 *   measured). Bun's own errors (`Connection closed`, a timeout) quote nothing.
 */

/** What replaces the arguments. */
export const OMITTED = '[arguments omitted]';

/**
 * `message` up to the first quoted thing that is not `command` (or one of its subcommands, which
 * the server writes `command|sub`), with `OMITTED` where the rest was.
 */
export function cutArguments(message: string, command: string): string {
  const name = command.toLowerCase();
  let at = message.indexOf("'");
  while (at !== -1) {
    const close = message.indexOf("'", at + 1);
    const quoted = close === -1 ? undefined : message.slice(at + 1, close).toLowerCase();
    if (quoted === undefined || !(quoted === name || quoted.startsWith(`${name}|`))) {
      return `${message.slice(0, at)}${OMITTED}`;
    }
    at = message.indexOf("'", close + 1);
  }
  return message;
}

/**
 * The client's rejection as an `Error` that is safe to put in a span, a log or a `RedisError`:
 * a fresh one, keeping Bun's `name` and `code`, with the arguments cut out of the text.
 */
export function scrubbedError(cause: unknown, command: string): Error {
  const original = cause instanceof Error ? cause : undefined;
  const scrubbed = new Error(cutArguments(original?.message ?? String(cause), command));
  if (original !== undefined) {
    scrubbed.name = original.name;
    const code: unknown = (original as { readonly code?: unknown }).code;
    if (typeof code === 'string') Object.assign(scrubbed, { code });
  }
  return scrubbed;
}
