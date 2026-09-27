# Upstream conformance: conforming building blocks

Status: extracted from the [conformance ledger](./upstream-conformance.md); its dated
measurements and open findings are preserved below.

- **`paperless/*` (`Tag`, `DocumentType`, `StoragePath`, `CustomField`)** — ✅ **S23 fixed
  2026-09-24** (branch `claude2/distilled-paperless-family`, decision 43, mirroring the
  netbox/forgejo migrations above). Every call now goes through `@distilled.cloud/paperless-ngx`'s
  typed operations, `catchTag('NotFound', …)` replaced the status-carrying `PaperlessError`
  union, and `client.ts`/`errors.ts`/`credentials.ts` are deleted. The shared
  `matching.ts`/`matching-locate.ts` engine (locate-by-name before state, by `output.id` after —
  PR 163) is unchanged in shape. Not published upstream yet, aliased onto
  `@homeflare/distilled-paperless-ngx@0.3.0` — [distilled-interim.md](./distilled-interim.md).
  State did not move: props/attributes stay byte-identical, proven by `tag.test.ts` and the full
  PR 163 regression suite (`tag-identity.test.ts`) against a fake exercising the real distilled
  protocol. ⛔ **Still diverges on credentials (S24):** `PAPERLESS_URL`/`PAPERLESS_TOKEN` are read
  at call time, now through the SDK's `CredentialsFromEnv` — same divergence, unchanged by the
  transport swap.
- **`github/RepositoryRuleset`** (added 2026-09-23) closes the hazard the row above names:
  probes by name (`read`/`reconcile` both), answers `Unowned` on a cold name match (H1),
  normalizes before comparing so a matching live ruleset is a true noop, and refuses
  (rather than silently drops) a live rule type it does not model. Two recorded
  divergences: the type string sits in upstream's own `GitHub` namespace (H14), and the
  client is Octokit rather than distilled because distilled's `S.Struct` request schemas
  have no field for `require_extra_approval_for_unattributed_changes` (H15) — see
  [repository-ruleset.md](./repository-ruleset.md). `declareRepoPolicy` is rewired onto
  it; the row below is now describing upstream `GitHub.Ruleset` itself, which this family
  does not touch and remains usable directly.
- **`github/declareRepoPolicy`** composes upstream `GitHub.Repository` and
  `GitHub.Ruleset`. Its one hazard is upstream's own: `Ruleset.read` returns `undefined`
  without prior output, so a first deploy creates a duplicate
  ([repo-policy.md](./repo-policy.md)). The fix belongs upstream: read by name and answer
  `Unowned`. Since 2026-09-23 `declareRepoPolicy` no longer takes this path (see the
  `RepositoryRuleset` row above); this remains accurate for upstream `Ruleset` on its own.
- **`cloudflare/website.ts`** sets house defaults over upstream `Website.Astro` and
  `Website.Vite`.
- **`ownership/*`** is built only on `AdoptPolicy`, `Stack`, `State` and `Artifacts`. Its
  apply-time re-check (H2) exists because beta.79 skips the adoption probe while props hold
  an Output. That fix also belongs in the engine upstream.
- **`verify/*`** (`hf-adopt-verify`) runs Alchemy's own planner. It exists because beta.79
  labels every cold adoption as an update (H6).
- **`google-workspace/*`** (new 2026-09-24, `Group`, `GroupMember`, `DomainAlias`, `OrgUnit`)
  is built directly on `@distilled.cloud/google-workspace@1.0.0-rc.12`'s typed
  `unstable/admin_directory_v1` operations from the first commit — no hand-rolled client ever
  existed for it to migrate off (S23), so there is no `client.ts` deletion to record. Every
  `fetchLive` is get-by-key with its own `catchTag('NotFound', …)`, the same split forgejo's and
  netbox's engines use (resource.ts). Get-by-key rather than NetBox's list-then-disambiguate,
  since Directory addresses every object this family models by a stable key. ⛔ **Diverges on
  credentials, same shape as the rest of this ledger (S24):** `GOOGLE_ACCESS_TOKEN` is read at
  call time through the SDK's own `CredentialsFromEnv` — but here the SDK provides no way to
  MINT that token at all (no service-account/DWD support), so a Bun wrapper outside this
  package (H8, unwritten by this PR) is load-bearing in a way NetBox's/Forgejo's simple
  API-token env vars are not. SDK gaps (the `unstable/` service tree, no per-operation error
  beyond the shared 4xx set, no group-alias update) and the full credential/scope setup:
  [google-workspace.md](./google-workspace.md).
