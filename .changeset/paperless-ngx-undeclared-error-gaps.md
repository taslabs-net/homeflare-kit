---
'@homeflare/distilled-paperless-ngx': minor
---

Patched the gaps in `@distilled.cloud/paperless-ngx`'s undeclared-error
patches from a live measurement (2026-09-23, authenticated GETs against a
real Paperless-ngx instance, read-only) instead of the original inferred
guesses:

- 404 added to every page-number LIST operation (19 tags), not just
  detail lookups — `GET /api/tags/?page=999999 → 404 {"detail":"Invalid
page."}` was measured live and shows list operations 404 too. Reuses the
  shared `NotFound` response/class per tag (distilled's OpenAPI converter
  names an error class purely from (module, status), so a list's "invalid
  page" 404 and a detail lookup's "no such object" 404 can't be split into
  distinct `catchTag`-able classes without inventing a convention
  distilled doesn't have — documented, not faked).
- The existing `ValidationError` response shape (field name → `[messages]`,
  no `detail`) is confirmed to match the measured 400 body exactly
  (`GET /api/documents/?id__in=notanumber`), and still routes to
  `BadRequest` correctly with no `detail` key present.
- `smithy.api#paginated` (page mode, `next`/`results`) stamped on the same
  19 tags' LIST operations, so `Services.<tag>.list<X>` is now a
  `PaginatedOperationMethod` with `.pages()`/`.items()` streaming —
  verified core's `paginatePageNumber` strategy still terminates correctly
  even though `next` is a full URL, not a page number. New
  `./Pagination` export (`paginatePageNumber`, re-exported from
  `@distilled.cloud/core`, following `@homeflare/distilled-hetzner`'s own
  convention for this pagination mode). `trash`'s list operation gets the
  404 but not the pagination trait — its `GET /api/trash/` response has no
  declared schema at all in the pinned document, so there is no `results`
  member to point at.
- The wrong-`apiBaseUrl` 302 trap (a redirect to the web UI, not JSON) is
  now documented in `src/protocol.ts`'s module doc.
- Every `patches/<tag>/_undeclared-errors.json` description now cites this
  measurement (date, request, status, body keys) instead of "not
  independently re-measured"; 403 stays explicitly flagged as inferred
  (unmeasured — it needs a permission-restricted credential, a write this
  pass could not create).

`src/` is copied verbatim from the distilled clone
(`homeflare/paperless-ngx`, local commits `71c7f576` and `2f1b3e56`) per
`packages/alchemy/docs/distilled-interim.md` — not hand-edited.
