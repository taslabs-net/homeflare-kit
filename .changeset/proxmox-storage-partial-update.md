---
'@homeflare/alchemy': patch
---

Fix `Proxmox.Storage` updates: `reconcile` used to PUT the FULL declared
form to `/storage/{storage}` whenever anything drifted, including a
`shared` that already matched what PVE reported live. Measured
2026-09-27, `bun run deploy`: updating `storage-cephfs-tb4` (only its
`content` had actually drifted, adding `import` for Talos) failed with
`InternalServerError: update storage failed: unexpected property
'shared'` — cephfs's own PVE storage plugin never accepts `shared` in its
`options()` at all (vendor-cited in the new `storage-plugin-options.ts`,
checked against `github.com/proxmox/pve-storage`, branch `master`,
2026-09-27), even though the combined `pve-apidoc` schema and distilled's
generated wire types both carry the field.

`updateForm` (`storage-form.ts`) now builds a genuinely partial PUT body:
once a live read exists, only the declared fields that differ from it
(`storage-wire.ts`'s new `changedProps`, shared with `matches`'s own
drift check so the two can never disagree) reach the wire, and `shared`
is additionally gated by a per-type accepted-list (`sharedAccepted`) so
it is never sent — or compared, which would otherwise make a plan loop
forever on a field nothing can ever apply — for a type whose plugin
doesn't accept it. `storage.ts`'s `reconcile` now computes that partial
form once and passes the same object to both `guardWrite` and the actual
`putStorage` call, so the vendor-constraint guard always checks exactly
what is sent.

New tests (`storage-update.test.ts`, no live PVE): a cephfs storage whose
only drift is `content` PUTs `content` and nothing else; an
already-matching storage sends no PUT at all; a `dir` storage (whose own
`DirPlugin.pm` options() does list `shared`) sends it when it drifts —
the accepted-type path, contrasted with cephfs's refused one.
