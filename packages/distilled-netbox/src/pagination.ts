/**
 * NetBox pagination — hand-written.
 *
 * NetBox list operations answer `{ count, next, previous, results }`
 * (DRF `LimitOffsetPagination`), with `next`/`previous` as FULL URLs, not a
 * bare token — see ../protocol.ts. Core's generic strategies in
 * `@distilled.cloud/core/pagination` (`paginateCursor`, `paginateToken`, …)
 * all work by taking the value at `outputToken` and writing it straight
 * back into the SAME field on the next request's input
 * (`{ ...input, [inputToken]: value }`). Handed a URL that way, the next
 * request would send it VERBATIM as a query value (e.g.
 * `?offset=http%3A%2F%2Fnetbox%2Fapi%2Fdcim%2Fdevices%2F%3Flimit%3D50%26offset%3D50`)
 * instead of actually advancing — none of core's modes parse a URL, so none
 * of them can follow NetBox's `next` correctly. (Same question, same
 * answer, for Paperless if its `next` is also a full URL: check first
 * whether its query params are also the operation's own declared input
 * members before reusing this pattern.)
 *
 * What DOES work: every NetBox list operation is generated with `limit`
 * and `offset` as ordinary, declared, typed query params (confirmed
 * identical across all 140 list operations, 2026-09-23), and `next`'s query
 * string carries nothing but a next value for those same params (whichever
 * ones the caller — or NetBox's default — used; NetBox also accepts a
 * pk-cursor `start` param as an alternative to `offset`, so this parses
 * whatever keys are actually present rather than hard-coding `offset`).
 * Since the URL's query params ARE the operation's own input shape,
 * `netboxPaginate` doesn't need to fetch the URL at all: it parses `next`'s
 * query string and merges those params back onto the typed input for the
 * SAME operation, exactly the escape hatch `API.makePaginated`'s optional
 * `strategy` argument exists for (see cloudflare's `cloudflarePaginate` for
 * the other precedent — a provider-local `PaginationStrategy` the shared
 * dispatcher can't express). Stops when `next` is absent or `null`.
 */
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Pagination from "@distilled.cloud/core/pagination";

/**
 * Coerce one parsed query value back to the type NetBox's schema declares:
 * every pagination param this URL can carry (`limit`, `offset`, `start`) is
 * numeric, so a value that round-trips through `Number()` becomes a number;
 * anything else (a future non-numeric param) is passed through as a string
 * rather than dropped.
 */
const coerce = (value: string): number | string => {
  if (value === "") return value;
  const n = Number(value);
  return Number.isNaN(n) ? value : n;
};

export const netboxPaginate: Pagination.PaginationStrategy = (
  operation,
  input,
  pagination,
) => {
  const outputToken = pagination.outputToken;
  if (!outputToken) {
    return Stream.die(
      new Error("NetBox pagination requires an outputToken (next)"),
    );
  }

  type State = { input: Record<string, unknown>; done: boolean };

  return Stream.unfold({ input, done: false } as State, (state) =>
    Effect.gen(function* () {
      if (state.done) return undefined;

      const response = yield* operation(state.input as any);
      const next = Pagination.getPath(response, outputToken);

      if (typeof next !== "string" || next.length === 0) {
        return [response, { input: state.input, done: true }] as const;
      }

      // `next` is always absolute in practice (NetBox echoes the request's
      // own scheme/host back); the base argument only anchors `new URL` for
      // a relative value a proxy might produce — its origin is discarded,
      // never dereferenced. Only the query string is read.
      let query: URLSearchParams;
      try {
        query = new URL(next, "http://netbox.invalid").searchParams;
      } catch {
        // An unparseable `next` can't be followed; stop rather than loop.
        return [response, { input: state.input, done: true }] as const;
      }

      // A multi-select filter (e.g. `?tag=a&tag=b`) appears in `next` as
      // REPEATED same-key pairs, not one comma-joined value — core's own
      // request builder serializes an array-typed query member that way
      // (protocol-http.ts's `appendQuery`). A naive last-write-wins merge
      // would silently drop every value but the last on every page after
      // the first, with no error (buildRequest reads `inputObj[key]`
      // directly and dispatches on `Array.isArray` at runtime, so a
      // demoted scalar just serializes as one value instead of failing).
      // Group by key instead, and keep a key as an array whenever `next`
      // repeats it OR the field was already array-typed on this input —
      // a filter narrowed to one surviving value must not lose its shape.
      const nextInput: Record<string, unknown> = { ...state.input };
      const byKey = new Map<string, string[]>();
      for (const key of query.keys()) {
        if (!byKey.has(key)) byKey.set(key, query.getAll(key));
      }
      for (const [key, values] of byKey) {
        const wasArray = Array.isArray(state.input[key]);
        nextInput[key] =
          values.length > 1 || wasArray
            ? values.map(coerce)
            : coerce(values[0] as string);
      }

      return [response, { input: nextInput, done: false }] as const;
    }),
  );
};
