# Alchemy changelog archive 8

[Current changelog](../../CHANGELOG.md) · [Archive index](./README.md)

Known trade-off (found by adversarial review, 2026-09-24): forcing the ruleset first only helps
once the repository already exists. A repo and its ruleset created together for the FIRST time,
with `checks` non-empty from day one, now fails clearly instead of racing — GitHub's own ruleset
API 404s on a repository that does not exist yet, and the engine now guarantees that order rather
than leaving it to chance. Both `declareRepoBaseline` and `declareRepoPolicy` document this and a
new test proves the failure is explicit, not a silent fail-open; the fix is for an ALREADY-LIVE
repo moving from no checks to some, which is K5's own scenario and the documented use of both
functions.

## 0.29.0

### Minor Changes

- [#222](https://github.com/taslabs-net/homeflare-kit/pull/222) [`1e6285f`](https://github.com/taslabs-net/homeflare-kit/commit/1e6285fb229dca7455afa5b52e1c79ca3286dc26) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Declare `@distilled.cloud/discord`, `@distilled.cloud/google-workspace` and `@distilled.cloud/grafana` (1.0.0-rc.12) as exact-pinned peers, ahead of the Discord, Google Workspace and Grafana provider families. Per the peer contract they are required, and they appear in the README install line and the smoke install.

- [#208](https://github.com/taslabs-net/homeflare-kit/pull/208) [`2d28264`](https://github.com/taslabs-net/homeflare-kit/commit/2d28264e71d9f141ff0771f57dab49d6daa79904) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `GitHub.RepositoryRuleset`'s `rules.pullRequest.extraApprovalForUnattributedChanges` now accepts
  `true`, not only `false`. Re-read live 2026-09-23, 8 rulesets carry
  `require_extra_approval_for_unattributed_changes: true` (aop, cloudflareforms,
  doesthishelp-workeropen, homeflare-anyauth, homeflare-desktop, loggarr, magictransit,
  proxmox-tb4), so this resource could not declare their exact shape before: it would either omit
  the field (leaving it unmanaged, refused once a caller also carries a `bypassActors`/rule
  declaration for the same ruleset) or send `false`, which is real drift against a live `true` on
  every plan.

  The wire builder now sends whatever is declared instead of hardcoding `false`; `undefined` still
  means "no opinion" (GitHub defaults an absent key to `true`). `repoBaselineRuleset()` in
  repo-baseline-data.ts is unchanged — the house baseline still pins `false` for the repos that
  fit it; a caller with a live `true` declares `RepositoryRuleset` directly with the live value,
  the same pattern kit PR 205 established for `bypassActors` and rule presence.

  Tested against aop's full live shape (`gh api repos/taslabs-net/aop/rulesets/14572279`,
  re-read 2026-09-23): declaring the live value (including `true`) is now a genuine zero-write
  adopt, and declaring `false` against a live `true` is still real drift, never a silent noop.

- [#214](https://github.com/taslabs-net/homeflare-kit/pull/214) [`9af4441`](https://github.com/taslabs-net/homeflare-kit/commit/9af4441462743476da58ee06af877ec0b346aa1f) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `GitHub.RepositoryRuleset`'s "never-reported context" guard (`refuseUnreportedContexts` /
  `hasContextReportedSuccess`) checked only the default branch's current tip. The house's rendered
  CI (`packages/config/src/repo-shape/ci.ts`) triggers on `pull_request` only, deliberately (no
  `push: [main]` — a squash-merged commit re-testing an already-green PR was ~41% of the mini's CI
  load, measured 2026-09-15..22), so `ci`, `secret scan` and `CodeQL` never report on the tip
  itself. The guard refused adding any of them everywhere, including homeflare-builds' pending
  first ruleset.

  `hasContextReportedSuccess` now falls back to up to `RECENT_MERGED_PR_LIMIT` (10) recent merged
  pull requests' head SHAs — one bounded list call, never the repo's full PR history — checked only
  if the tip itself has no reported success. A context that has never reported success ANYWHERE
  (not the tip, not any recent merged head) is still refused: the guard's whole purpose is
  unchanged, only where it is willing to look for evidence widened.

  The core logic (`contextReportedSuccess`, `hasRefReportedSuccess`, `recentMergedHeadShas`) is now
  exported as plain functions over a real `OctokitClient`, not only reachable through the
  `GitHubCredentials`-gated `RulesetOctokit` — the same pure-function seam `desiredWireRuleset`
  already uses — so `repository-ruleset-octokit.test.ts` measures it against a real `@octokit/rest`
  instance with a fetch shim (no network), mirroring the H15 wire test: accepting a context that
  reports only on a recent merged head, refusing one that reports nowhere, and refusing one whose
  only success is older than the bound (the limit is real, not decorative).

### Patch Changes

- [#219](https://github.com/taslabs-net/homeflare-kit/pull/219) [`40c08eb`](https://github.com/taslabs-net/homeflare-kit/commit/40c08ebfc3ca04de7338deb95b217fbdce6c50d7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The `caddy/*` family (`Caddy.Config`, `caddyWithFile`, `localCaddyAdmin`) now calls
  `@distilled.cloud/caddy`'s typed `admin` operations (`adaptConfig`, `loadConfig`,
  `getConfig`) instead of a hand-rolled promise-based `CaddyAdmin.request()` interface.
  Every operation's error channel is `catchTag`-able (`Caddy.CaddyOpError`); `isUnreachable`
  (caddy-http-client.ts) is a type guard over the SDK's own `HttpClientError`, replacing the
  old `CaddyUnreachableError` class, and gates the same "plan without Caddy" escape hatch
  config.ts always had.

  The measured local transport survives unchanged in shape: loopback TCP or a unix socket,
  Host/Origin headers as the Caddy CLI sends them, retrying only a connection nothing
  accepted (`ECONNREFUSED`/`ENOENT`) — now built as an Effect `HttpClient.HttpClient` layer
  (`caddy-http-client.ts`) the SDK's protocol runs over, over `node:http` (not
  `FetchHttpClient`: only `node:http` dials a unix socket on both Bun and Node). The
  `LoadRefused` 200-trap (a refused `/load` that still answers 200 with the error appended
  after the adapter's warnings) is first-class in the SDK's own `protocol.ts`, not
  re-detected here.

  Two real gaps this migration found and fixed at the source, never worked around in the
  resource:

  - `@distilled.cloud/caddy`'s `AdaptConfig`/`LoadConfig` JSON-encoded the Caddyfile TEXT and
    overwrote the caller's `Content-Type` — fixed in the distilled clone's `protocol.ts` and
    shipped as `@homeflare/distilled-caddy@0.2.1` (sibling changeset).
  - The SDK's own default retry policy treats any transport-level `HttpClientError` as
    retryable, including a `POST /load` that was already accepted before the connection
    reset — `local-admin.ts` now disables it (`Caddy.Retry.Retry`) so caddy-http-client.ts's
    own narrower ECONNREFUSED/ENOENT-only retry is the only one in play.

  `providers.ts`'s `caddyProviders()` (and this family's own tests) also fix a wiring bug the
  migration surfaced: `CaddyConfigProvider().pipe(Layer.provide(caddyAdminLayer(...)))`
  seals `caddyAdminLayer`'s services away from the provider's `read`/`diff`/`reconcile`
  handlers once they are built, so the engine's later call to any of them died with "Service
  not found". `Layer.provideMerge` keeps those services live for every later call.

  State did not move: props and attributes stay byte-identical (`configSha256`, `endpoint`,
  `sourceFile`) — proven by the family's existing tests (updated only where the typed-error
  message text itself changed, from the old ad hoc `method path -> status` strings to the
  SDK's own tagged errors) plus fake-caddy.ts, a real HTTP server, so every test already
  drives the real distilled wire protocol, not a re-implementation of it.

- [#209](https://github.com/taslabs-net/homeflare-kit/pull/209) [`1eaf80f`](https://github.com/taslabs-net/homeflare-kit/commit/1eaf80f9ef2ad5e616f1a459ed6396819be15e6c) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The `proxmox/*` family's `Proxmox.Acl` (the first resource in the PVE
  `access/ACL` sub-area, per decision 43's serial proxmox walk-down) now calls
  `@distilled.cloud/proxmox`'s typed `access.listAccessAcl`/`access.putAccessAcl`
  operations instead of `client.ts`'s hand-rolled, generic `pve()` call. A new
  `distilled-pve.ts` module (`runPve`/`runPveWith`) replaces `pve()`/`pveWith`
  for a migrated family: the same OpenBao lease reuse (`lease-cache.ts`,
  unchanged) and the same cluster-member failover safety rule (`members.ts`,
  unchanged — a write may repeat only on a provably pre-send transport
  failure, never on an HTTP answer or a post-connect timeout), now re-running
  the whole typed operation per member instead of retrying one already-built
  request. `client.ts`/`pveOperations` are untouched and still serve every
  other PVE family; `Proxmox.Acl` is the first to move off them, chosen
  because it was already the one family that didn't fit the generic
  path+form shape (no create/delete verb — PVE has only GET/PUT on
  `/access/acl`).

  One dead branch is removed, not preserved: the old code's generic factory
  POSTed on a "live read undefined" case that its own comments called
  unreachable on a healthy cluster and documented as actively misleading (PVE
  has no POST here, so the 501 it got back said nothing about the real
  failure). `@distilled.cloud/proxmox` has no `createAccessAcl` at all — the
  vendor schema has no POST for the generator to make one from — so there is
  nothing to call that way any more. `reconcile` now always PUTs, the only
  write PVE actually implements for this path, so a read that genuinely fails
  surfaces its real cause instead of a confusing 501.

  A trap found while writing the member-failover test: `@distilled.cloud/core`'s
  default retry policy retries transport failures automatically (not just
  5xx answers), which could have resent a write to the same member several
  times before this file's own cluster failover ever saw a result to
  classify — the hand-rolled client never auto-retried anything. `distilled-pve.ts`
  disables the SDK's retry (`Retry.none`) on every attempt, keeping
  member failover the only place a request repeats, matching the original
  behavior exactly.

  State did not move: `AclProps`/`AclAttributes` are unchanged, and the
  existing cross-family `adopt-noop.test.ts` case for `Proxmox.Acl` (an
  already-matching grant is read-only) passes unmodified against the new
  code. New tests (`acl.test.ts`, `distilled-pve.test.ts`) drive a fake PVE
  server through the real distilled protocol — real path assembly, real
  form-urlencoded PUT bodies, real `{"data": ...}` envelope — covering
  create, drift-correction, delete, identity-replace, the read-back guard,
  and cluster-member failover for both a read and a write.

  This is PR 1 of a serial, sub-area-by-sub-area migration
  (access/ACL, then nodes/storage, then notifications, then PBS, …) of the
  ~98-resource PVE family plus the PBS resources onto
  `@distilled.cloud/proxmox`/`@distilled.cloud/proxmox-backup`. The other PVE
  and PBS resources still call `client.ts`'s `pve()`, unchanged; `client.ts`
  is deleted only once nothing imports it.

- [#215](https://github.com/taslabs-net/homeflare-kit/pull/215) [`72c448d`](https://github.com/taslabs-net/homeflare-kit/commit/72c448dbaec8f2acb7b5109aa7387a4409185fe8) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fix a review finding on the `litellm/*` distilled migration (`@homeflare/distilled-litellm`'s
  `CredentialsFromEnv`, S20): a missing or misspelled `LITELLM_PROXY_URL`/`LITELLM_PROXY_API_KEY`
  used to die as an unrecoverable Effect defect and crash the whole engine, instead of the typed
  `ConfigError` `LitellmOpError` already declared — a regression this migration made newly
  reachable from `LiteLLM.PassThroughEndpoint`'s `read`/`reconcile`/`delete` (the retired
  hand-rolled `credentials.ts` failed typed). Fixed at the source, per house rule: the distilled
  `litellm` package's own `credentials.ts` no longer ends in `Effect.orDie`, copied forward into
  `@homeflare/distilled-litellm` unchanged. No prop, attribute or public API changed.

  `netbox/*`'s `CredentialsFromEnv` has the identical shape and is not fixed by this changeset —
  tracked separately (`docs/upstream-conformance.md` finding 9).

- [#210](https://github.com/taslabs-net/homeflare-kit/pull/210) [`2002713`](https://github.com/taslabs-net/homeflare-kit/commit/20027131b716058de035bd1d8423054f3e9dbff0) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The `litellm/*` family (`LiteLLM.PassThroughEndpoint`) now calls `@distilled.cloud/litellm`'s
  typed `misc` operations instead of a hand-rolled `Effect HttpClient` client. The old
  status-carrying `LitellmBadRequestError`/`LitellmUnauthorizedError`/`LitellmHttpError`/
  `LitellmTransportError` are gone: every failure the SDK's four operations declare (`BadRequest`,
  `NotFound` on update, `UnprocessableEntity`, plus the shared default HTTP errors) is the SDK's own
  typed error, `catchTag`'d. `deletePassThroughEndpoint`'s re-list-on-ambiguous-delete trick is
  unchanged, now keyed on the `BadRequest` tag instead of a status code. The per-base-URL write
  semaphore LiteLLM's whole-list storage forces is unchanged, moved into the new `operations.ts`.
  `client.ts` and the kit's own hand-generated `generated/pass-through.ts` are both deleted — the
  SDK's `misc.PassThroughGenericEndpoint` is the same shape, generated from the same LiteLLM 1.100.0
  OpenAPI document. The `codegen/litellm.ts` generator and `tests/litellm-manifest.test.ts` that
  kept that file current are retired with it; the `litellm-openapi` manifest entry stays, recorded
  as consumed by nothing, the same pattern the two UniFi entries already establish.
