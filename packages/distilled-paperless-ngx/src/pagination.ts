/**
 * Paperless-ngx pagination — hand-written.
 *
 * Every paginated Paperless-ngx list operation is page-number mode: `page`
 * (and `page_size`) in, and a `{ count, next, previous, results }` envelope
 * out — DRF's `PageNumberPagination`. `next` (and `previous`) is a FULL URL
 * (or `null` on the last/first page), never a bare page number — measured
 * live 2026-09-23, see `patches/<tag>/_undeclared-errors.json` for the
 * request/response evidence.
 *
 * Generated list operations pass core's {@link paginatePageNumber} strategy
 * to `API.makePaginated` with `outputToken: "next"`. That strategy only
 * treats a token as the next page number when it is `typeof "number"`
 * (never true for a URL) — otherwise it advances the local page counter by
 * one and terminates the stream once the token comes back `null` — which is
 * exactly DRF's last-page signal. So iteration is correct even though the
 * token is a URL: the strategy never needs to dereference it, only to
 * notice when it disappears.
 */
export { paginatePageNumber } from "@distilled.cloud/core/pagination";
