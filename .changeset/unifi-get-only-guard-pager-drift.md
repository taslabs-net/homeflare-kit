---
'@homeflare/alchemy': patch
---

`Unifi.*` providers now refuse any non-`GET` request at the wire (`GetOnlyHttpClient`, installed in `unifiHandlers`), defense in depth alongside the existing per-operation write refusal, backed by a static test that bans any create/update/delete/patch/execute/remove/adopt SDK reference under `src/unifi`. Added `src/unifi/paginate.ts`'s consumer-side offset pager for the SDK's un-paginated list operations, and a pure `driftOf(live, props)` per family (`Unifi.Network`, `Unifi.FirewallZone`) reporting field-level drift for a future pre-import check.
