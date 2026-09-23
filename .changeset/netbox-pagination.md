---
'@homeflare/distilled-netbox': minor
---

Stamped `smithy.api#paginated` on all 140 NetBox list operations, so every
`Services.<module>.list*` operation now has `.pages()` / `.items()`.

NetBox's list endpoints answer `{count, next, previous, results}` with
`next`/`previous` as full URLs (DRF `LimitOffsetPagination`), not a bare
token core's generic pagination strategies (`paginateCursor`/
`paginateToken`/`paginatePageNumber`) can follow — each one writes the raw
`outputToken` value straight back into the next request's typed input, and
a URL there would be sent verbatim as a query value instead of advancing
the page. Since the URL's query params ARE the operation's own declared
`limit`/`offset` input members (verified identical across all 140 list
operations), a hand-written `netboxPaginate` strategy (`src/pagination.ts`)
parses `next`'s query string and merges those params back onto the typed
input instead — the same provider-local `PaginationStrategy` override
`@distilled.cloud/cloudflare`'s `cloudflarePaginate` uses for its own
generic-dispatcher gap.

Copied forward from the distilled clone (`homeflare/netbox` branch,
`packages/netbox` — not pushed upstream, per decision 42) per
`packages/alchemy/docs/distilled-interim.md`. `types` and `scripts/smoke.ts`
(extended to follow a synthetic two-page `next` chain end-to-end through
the packed tarball) both pass.
