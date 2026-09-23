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
 * one, and terminates on EITHER of two independent signals: `next` coming
 * back `null` (DRF's own last-page marker), or `results` coming back empty
 * on any page (belt-and-suspenders — Paperless-ngx never actually returns
 * this for a page within range, since an out-of-range `page` 404s instead,
 * measured live 2026-09-23; see `patches/<tag>/_undeclared-errors.json`).
 * So iteration is correct even though the token is a URL: the strategy
 * never needs to dereference it, only to notice when it disappears.
 */
export { paginatePageNumber } from "@distilled.cloud/core/pagination";
