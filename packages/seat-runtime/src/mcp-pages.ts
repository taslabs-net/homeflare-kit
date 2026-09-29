/**
 * MCP's cursor pagination, followed to the end — but not forever.
 *
 * ⛔ THE PAGE COUNT IS CAPPED. A server that answers every page with another `nextCursor` (a
 *   bug, or a hostile one) would otherwise hold a seat in a listing loop before its first
 *   model call. A hundred pages is far past any estate server's tool list; the cap fails the
 *   listing loudly instead of truncating it quietly.
 */
import * as Effect from 'effect/Effect';
import { type McpOperation, McpToolkitError } from './mcp-error.ts';

export const MAX_PAGES = 100;

export type Page<T> = { readonly items: ReadonlyArray<T>; readonly next: string | undefined };

/** Every item of a paged listing, or an `McpToolkitError` for `operation`. Interruption aborts the request in flight. */
export function collect<T>(
  operation: McpOperation,
  server: string,
  page: (cursor: string | undefined, signal: AbortSignal) => Promise<Page<T>>,
): Effect.Effect<ReadonlyArray<T>, McpToolkitError> {
  return Effect.tryPromise({
    try: async (signal) => {
      const items: T[] = [];
      let cursor: string | undefined;
      for (let pages = 0; pages < MAX_PAGES; pages += 1) {
        const next = await page(cursor, signal);
        items.push(...next.items);
        if (next.next === undefined) return items;
        cursor = next.next;
      }
      throw new Error(`the server returned more than ${String(MAX_PAGES)} pages`);
    },
    catch: (cause) => new McpToolkitError({ operation, server, cause }),
  });
}
