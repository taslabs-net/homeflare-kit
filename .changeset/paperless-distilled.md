---
'@homeflare/alchemy': patch
---

The `paperless/*` family (`Tag`, `DocumentType`, `StoragePath`, `CustomField`) now calls
`@distilled.cloud/paperless-ngx`'s typed operations instead of a hand-rolled `Effect HttpClient`
client. `client.ts`, `errors.ts` and `credentials.ts` are gone; every status check
(`statusToError`, the status-carrying `PaperlessError` union) is replaced by
`Effect.catchTag('NotFound', …)` at each resource file's own `getById` call, the same rule
`forgejo/*` and `netbox/*` follow — a LIST call is never folded to absent at all, since an empty
page is a normal 200 (measured live, kit PR 194). The shared `matching.ts`/`matching-locate.ts`
engine (locate-by-name before there is state, by the stored `output.id` after — PR 163) is
unchanged in shape, generalized only over the SDK's typed `Live` row and each family's own
distilled error union instead of an untyped `PaperlessRow`.

`@distilled.cloud/paperless-ngx` is not published upstream yet, so this package was already
aliased onto `@homeflare/distilled-paperless-ngx@0.3.0` (kit PR 188/194/206 — built the distilled
way and shipped from this monorepo, see `docs/distilled-interim.md`); this PR is the first thing
that actually imports it. `packages/alchemy`'s own `build:interim-deps` now builds it too, and
picks up a pre-existing bug in the same line while doing so: `bun --cwd <dir> run <script>`
(space-separated) silently no-ops instead of building — `bun --cwd=<dir> run <script>` is the form
that actually works. Fixed for all three interim deps this script already named (netbox, proxmox,
paperless-ngx); the root-level `scripts/build-interim-packages.ts` was never affected, since it
spawns `bun run build` with an explicit `cwd` option rather than a shell string.

Credentials still resolve from `PAPERLESS_URL` / `PAPERLESS_TOKEN` at call time, now through the
SDK's own `CredentialsFromEnv`, baked directly into each of the four `xxxProvider()`s the same way
`netboxHandlers`/`forgejoHandlers` do — `providers.ts`'s `paperlessProviders()` no longer takes a
credentials-layer override (nothing in this estate called it with one: measured 2026-09-24, no
tray repo under `homeflare-landscape` declares a Paperless resource at all). Props and attributes
are unchanged — an adopted tag, document type, storage path or custom field still plans noop.
