# Alchemy changelog archive 9

[Current changelog](../../CHANGELOG.md) · [Archive index](./README.md)

Not published upstream yet, so aliased onto `@homeflare/distilled-litellm@0.2.0` as a plain
`dependencies` entry, not a peer — see `docs/distilled-interim.md`. Credentials still resolve
from `LITELLM_PROXY_URL` / `LITELLM_PROXY_API_KEY` at call time, now through the package's own
`CredentialsFromEnv` layer. Props and attributes are unchanged — an adopted pass-through endpoint
still plans noop.

- [#212](https://github.com/taslabs-net/homeflare-kit/pull/212) [`e419a44`](https://github.com/taslabs-net/homeflare-kit/commit/e419a44f45e3332eb9ae7c3b196d203309668f26) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The `paperless/*` family (`Tag`, `DocumentType`, `StoragePath`, `CustomField`) now calls
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

- [#220](https://github.com/taslabs-net/homeflare-kit/pull/220) [`4da7ecc`](https://github.com/taslabs-net/homeflare-kit/commit/4da7ecc7d5dd59e0c9aab3a4a13dee148f9a14a9) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `client.ts`'s `executeOnCluster` and `distilled-pve.ts`'s `runPveWith`
  (`members.ts`, shared by both) now bound a single cluster-member attempt with
  a new `MEMBER_TIMEOUT` (20 seconds). Previously nothing did: a PVE member
  that accepted the TCP connection but never answered hung the whole call
  forever, because the cluster-failover loop never got a failure to classify
  and so never reached a healthy member — this affected every PVE resource,
  migrated or not, since both codepaths funnel through `executeOnCluster`. A
  bounded timeout now fails a read over to the next member (no side effect to
  duplicate) and fails a write outright without resending it, matching the
  existing rule that a post-connect failure is never pre-send. Found on review
  of `Proxmox.Acl`'s migration (PR 209); fixed once, shared by every PVE
  family.

- [#216](https://github.com/taslabs-net/homeflare-kit/pull/216) [`eaa12e5`](https://github.com/taslabs-net/homeflare-kit/commit/eaa12e532fc420a74efd8df717e1fe080f1e3840) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `repoBaselineSettings` (repo-baseline-data.ts) no longer turns `allowAutoMerge` on
  unconditionally — it now follows `checks.length > 0`, the same as the sibling `repoPolicy` path
  already refuses to do (`repo-policy-guards.ts`'s `assertAutoMergeWaits`). With zero required
  status checks, `gh pr merge --auto` (and the ruleset's own auto-merge) has nothing to wait for:
  GitHub merges a CLEAN pull request on the spot, with no review and no green run required. A repo
  declared through `declareRepoBaseline` with an empty `checks` list (homeflare-anyauth today, for
  example — no workflows, so no checks to name) would otherwise get auto-merge turned on with
  nothing gating it.

  This baseline has no `autoMerge` opt-out prop the way `repoPolicy` does, so the fix is
  unconditional rather than a thrown refusal: a repo with checks keeps `allowAutoMerge: true`
  exactly as before; one without simply never gets it turned on by this baseline.

- [#217](https://github.com/taslabs-net/homeflare-kit/pull/217) [`ad397ea`](https://github.com/taslabs-net/homeflare-kit/commit/ad397eadbff8c20fef5c9634980b99ce65203758) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `GitHub.RepositoryRuleset`'s `Resource<>` declaration put `GitHubCredentials` in its 5th
  (`Providers`) type parameter, which puts that credential requirement on every `yield*
RepositoryRuleset(...)` call site — including inside `declareRepoPolicy`/`declareRepoBaseline`.
  A stack body cannot supply `GitHubCredentials` itself (`Alchemy.Stack`'s own `ProviderServices`
  type is a closed union `GitHubCredentials` does not structurally match), so any consumer whose
  stack body calls `declareRepoPolicy`/`declareRepoBaseline` — or declares `RepositoryRuleset`
  directly — failed `tsc` (measured 2026-09-24: homeflare-builds bumping to 0.27.4, TS2345).

  Verified against upstream `alchemy@2.0.0-beta.79`'s own `GitHub.Ruleset`
  (`node_modules/alchemy/src/GitHub/Ruleset.ts`): its 5th slot is `GitHub.Providers`, the
  `ProviderCollection` tag `GitHub.providers()` outputs — never the raw `GitHubCredentials`
  service its own provider handlers pull in via `octokitFor`. `RepositoryRuleset` now omits the
  5th parameter, defaulting its declaration requirement to `Provider<RepositoryRuleset>` instead —
  a real `ProviderServices` member, matching the pattern a standalone (non-collection) resource
  needs.

  Fixing only the declaration was not enough on its own: `GitHub.providers()` and
  `RepositoryRulesetProvider()` written side by side as a stack's `providers` still fails to
  typecheck, because `RepositoryRulesetProvider()`'s handlers need `GitHubCredentials` fed in, and
  merging two layers does not thread one's output into the other's requirement. New export
  `repoPolicyProviders()` (`repository-ruleset-providers.ts`) composes the two correctly —
  `RepositoryRulesetProvider().pipe(Layer.provideMerge(GitHub.providers()))` merged with
  `GitHub.providers()` itself — and is now the documented wiring in `docs/repo-policy.md`,
  `docs/repository-ruleset.md`, `repo-policy.ts` and `declare-repo-baseline.ts`.

  Added a type-level test (`repo-policy-stack.test.ts`): a real `Alchemy.Stack(...)` whose body
  calls `declareRepoPolicy` and `declareRepoBaseline` with `repoPolicyProviders()`, built (never
  run) so `tsc` checks it on every `bun run check` — the test that would have caught this before
  it reached a consumer's bump PR.

  No runtime behavior changes: every CRUD handler (`read`/`diff`/`reconcile`/`delete`) and its own
  `GitHubCredentials` requirement is unchanged — only the type surface a stack body sees when
  declaring the resource, and how the two providers compose, is fixed.

## 0.28.0

### Minor Changes

- [#206](https://github.com/taslabs-net/homeflare-kit/pull/206) [`06591c9`](https://github.com/taslabs-net/homeflare-kit/commit/06591c91d622178fdf1b09d8ac2f455bafa70107) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Aliases four more distilled interim SDKs onto `@homeflare/alchemy`'s
  `dependencies`, following `docs/distilled-interim.md`'s step 5:
  `@distilled.cloud/proxmox-backup`, `@distilled.cloud/paperless-ngx`,
  `@distilled.cloud/litellm` and `@distilled.cloud/caddy`, each aliased onto
  its published `@homeflare/distilled-<vendor>` interim copy (kit PRs [#200](https://github.com/taslabs-net/homeflare-kit/issues/200),
  [#194](https://github.com/taslabs-net/homeflare-kit/issues/194)/[#195](https://github.com/taslabs-net/homeflare-kit/issues/195), [#201](https://github.com/taslabs-net/homeflare-kit/issues/201), [#202](https://github.com/taslabs-net/homeflare-kit/issues/202)) at its current workspace version — not opnsense or
  unifi-network, neither of which is aliased anywhere yet. No resource in this
  package imports any of the four yet; that migration is each family's own
  later PR, per `distilled-interim.md`'s "what NOT to do".

  The root `build:interim-packages` script (kept root-level and non-nested,
  the CI-race fix from kit PR [#193](https://github.com/taslabs-net/homeflare-kit/issues/193)) is now generic: it discovers which
  `packages/distilled-*` copies to build by scanning every workspace
  manifest's `dependencies` for a `"@distilled.cloud/<vendor>":
"npm:@homeflare/distilled-<vendor>@<version>"` alias, instead of a
  hard-coded netbox/proxmox list — a new alias needs no edit to this script.
  `tests/catalog.test.ts`'s `EXACT_PEERS` table is now derived the same way
  for every `distilled-*` interim copy (`effect` alone, one reasoning comment
  kept in one place) instead of one hand-added entry and comment per vendor,
  which had become a recurring merge-conflict hot spot across concurrent
  interim-package PRs landing the same night.

  This is a `minor`, not a `patch`: `@homeflare/alchemy`'s own `dependencies`
  gained four new runtime entries, even though no exported code changed.

- [#205](https://github.com/taslabs-net/homeflare-kit/pull/205) [`3ab881e`](https://github.com/taslabs-net/homeflare-kit/commit/3ab881ecd53108050b1d23db39d955e82a07c322) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `GitHub.RepositoryRuleset` now expresses a live ruleset's exact shape when that shape is
  narrower than the house baseline: a `rules.pullRequest: false` declares its deliberate absence
  (matching the `requiredStatusChecks: false` pattern that already existed), and `bypassActors`
  already carried an arbitrary `actor_id`/`actor_type`/`bypass_mode` list — the gap was never the
  prop shape, it was that nothing stopped a declaration from silently narrowing what is live.

  Two new guards close that: `bypassNarrowingRefusal` refuses a declared `bypassActors` that drops
  a live actor, and `ruleNarrowingRefusal` refuses a declared `false` (any modeled rule) that drops
  a rule the live ruleset still has — both unless the declaration also carries the matching new
  prop, `acknowledgeBypassNarrowing: { reason: string }` or `acknowledgeRuleNarrowing: { reason:
string }`, a reasoned, explicit sign-off. The two acknowledgements are deliberately separate
  props, not one shared flag: an adversarial review found that a single shared
  `acknowledgeNarrowing` let a reason worded for one kind of drop silently also excuse the other
  kind in the same declaration, so each guard now reads only the prop scoped to what it checks.
  Widening bypass stays refused unconditionally, as before — this only ever loosens the NARROWING
  side, and only with a recorded, correctly-scoped reason.

  Prompted by a red-team finding against a design for declaring ~88 `taslabs-net` repos' GitHub
  settings in Alchemy: 5 live repos (`taslabs-net`, `aop`, `magictransit`, `loggarr`,
  `doesthishelp-workeropen`) carry a non-empty live `bypass_actors`, and `taslabs-net` itself has
  no live `pull_request` rule — the exact combination `repoBaselineRuleset()`'s hardcoded
  `bypassActors: []` and always-on `pullRequest` rule could not adopt without silently stripping
  protection. `repoBaselineRuleset()` itself is unchanged — it keeps its baseline defaults, for
  repos the baseline shape actually fits; a caller with a narrower live ruleset now declares
  `RepositoryRuleset` directly with the live shape instead.

  Tested against all 5 live shapes, re-read via `gh api repos/taslabs-net/<repo>/rulesets/<id>`
  2026-09-23 (not copied from an earlier paraphrase — `doesthishelp-workeropen`'s two bypass
  actors' `bypass_mode`s differ from how an earlier design doc described them).

## 0.27.4

### Patch Changes

- [#193](https://github.com/taslabs-net/homeflare-kit/pull/193) [`41bdc5d`](https://github.com/taslabs-net/homeflare-kit/commit/41bdc5d8f32fca92d60ee667b85306c77cea2442) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The `netbox/*` family (`Netbox.Prefix`) now calls `@distilled.cloud/netbox`'s
  typed `ipam` operations instead of a hand-rolled `Effect HttpClient` client.
  The old status-carrying `NetboxError` and its `cause.status === 404` check
  are gone: `Netbox.Prefix` locates by a server-side list filter, which
  `@distilled.cloud/netbox` never answers with a 404 (an empty page is a
  normal 200), so nothing here checks a status code at all — a stronger
  version of the same rule `catchTag('NotFound', …)` enforces for a
  distilled-backed family that reads by direct key, like `forgejo/*`.
  `client.ts` is gone; nothing else in this package imported it. The real
  `@distilled.cloud/netbox` is not published upstream yet, so this package
  aliases it onto `@homeflare/distilled-netbox@0.2.0` (built the distilled way
  and shipped from this monorepo — see `docs/distilled-interim.md`) as a plain
  `dependencies` entry, not a peer — nothing changes for a consumer's install.
  Credentials still resolve from `NETBOX_URL` / `NETBOX_TOKEN` at call time,
  now through the package's own `CredentialsFromEnv` layer. Props and
  attributes are unchanged — an adopted prefix still plans noop.

## 0.27.3

### Patch Changes
