# Alchemy changelog archive 7

[Current changelog](../../CHANGELOG.md) · [Archive index](./README.md)

- [#231](https://github.com/taslabs-net/homeflare-kit/pull/231) [`11705f2`](https://github.com/taslabs-net/homeflare-kit/commit/11705f2b88d19335be5a115e06f7f6ca883b63b3) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The `proxmox/*` family's `access` sub-area (decision 43's serial proxmox
  walk-down, PR 2 after `Proxmox.Acl` in PR 209/220) now calls
  `@distilled.cloud/proxmox`'s typed `access.*` operations instead of
  `client.ts`'s hand-rolled, generic `pve()` call: `Proxmox.User`, `Proxmox.Group`,
  `Proxmox.Role` and `Proxmox.ApiToken`. Each gets its own hand-written
  reconcile (read/diff/reconcile/delete), the way `acl.ts` established, rather
  than the shared `pveHandlers`/`pveOperations` factory — a `*-wire.ts` sibling
  per family holds the pure wire-shape functions (create/update forms,
  attributes, `matches`), keeping every file under the house's 250-line cap.
  `client.ts`/`pveOperations` are untouched and still serve every other PVE
  family; nothing in `nodes`, `storage`, `notifications` or PBS has moved yet.

  `Proxmox.Role` reads via `GET /access/roles` (the list), not the item
  `GET /access/roles/{roleid}` this family used before: distilled's generated
  schema for the item response enumerates a FIXED set of ~47 known privilege
  field names, and a privilege outside that set would silently vanish from
  state on every read. The list's `privs` field is the same plain comma string
  PVE's item read also disagreed with the index about pre-migration, with no
  fixed enumeration to fall behind — `role-wire.ts`'s `find` does the item
  read's old client-side job. Every other family in this PR still reads the
  item it read before.

  A `distilled-guard.ts` module (`asForm`/`guardWrite`) is the generalized
  form of `acl.ts`'s own local `guardWrite`, needed because distilled's
  generated request interfaces have no index signature and TypeScript refuses
  `Record<string, string | undefined>` for them directly — `body: object`
  plus one internal cast is the fix, applied once here rather than at every
  call site.

  **The cries-wolf fix** (measured 2026-09-24: `bun run plan` on the agent lane
  showed "19 to update" — 14 ACLs and 5 storages — because a REFUSED read
  folded into "absent" and `diff` forced `update` without comparing a field).
  `credentials.ts`'s `mint` now fails a 403 from OpenBao (a denied
  role — "this identity's AppRole has no grant") with a new typed
  `PveCredentialDenied` (`credential-errors.ts`), split out from the newly
  `mint.ts`-housed `mint`/`authorization` to keep `credentials.ts` under the
  line cap. A new `unreadable-read.ts` module's `readOrUnreadable` `catchTag`s
  exactly that one tag — never any other read failure — turning it into an
  `UNREADABLE` sentinel `diff` can tell apart from a genuine absence. Upstream's
  `Diff` type is exactly `NoopDiff | UpdateDiff | ReplaceDiff`
  (`packages/alchemy/src/Diff.ts@v2.0.0-beta.79`) with no fourth action, and
  `Plan.ts`'s resource pass fails the WHOLE plan if even one resource's `diff`
  throws — so `diff` now reports `{action: 'noop'}` plus a logged warning for
  an unreadable row, never a failed plan and never a forced write. Wired into
  `acl.ts` (the already-migrated family) and every family in this PR;
  `unreadable-read.test.ts` proves it end to end through Alchemy's real Plan
  and Apply, with a fake OpenBao that denies `provision` mid-test. `storage.ts`
  and the other five false updates stay open until `nodes`/`storage` migrates.

  Distilled's `{userid}`/`{tokenid}` label substitution percent-encodes them
  (`iac@pve` -> `iac%40pve`), where `client.ts`'s plain string concatenation
  sent the `@` literally — a real PVE decodes both the same way, so this is
  not a behaviour change a stack observes, but every fake cluster with an `@`
  in a userid (`user.test.ts`, `api-token-adopt.test.ts`,
  `provision-declare.test.ts`) now decodes the path before matching it.

  State did not move: every Props/Attributes interface is unchanged, and the
  existing cross-family `adopt-noop.test.ts` cases (now extended with `Group`
  and `User` rows for the new hand-written reconciles) and
  `api-token-adopt.test.ts` pass with the same assertions the pre-migration
  code made. New tests (`group.test.ts`, `user.test.ts`, `role.test.ts`)
  drive a fake PVE server through the real distilled protocol, covering
  create, drift-correction, delete, retain-by-default and the read-back guard.

  `codegen/constraints.ts` regenerated: `Proxmox.ApiToken` no longer names its
  (always-unreachable) create endpoint anywhere in source, so the generated
  tables and the hand-written ownership ledger
  (`scripts/proxmox-ownership-pve.ts`) both drop that one claim — 74 tabled
  endpoints, not 75.

## 0.31.0

### Minor Changes

- [#228](https://github.com/taslabs-net/homeflare-kit/pull/228) [`25610e8`](https://github.com/taslabs-net/homeflare-kit/commit/25610e890ac360456c318dd8dbefd0d54ccf0d3e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - New `@homeflare/alchemy/discord` subpath, built directly on `@distilled.cloud/discord`
  (1.0.0-rc.12) — no hand-rolled client ever existed for this vendor to retire.
  `Discord.ApplicationCommand` (global) and `Discord.GuildApplicationCommand` (guild-scoped)
  declare a slash/user/message command; `reconcile` is one upsert call, matching Discord's own
  create-endpoint semantics (a command with the same name overwrites the old one), the same shape
  `Cloudflare.Snippets.Snippet`'s `putSnippet` uses upstream. `read` follows that same upstream
  reference for a marker-less API exactly: a cold match is `Unowned`, never a silent adopt, and
  both convenience constructors (`applicationCommand`, `guildApplicationCommand`) pipe `adopt(true)`
  by default. Rate limits are handled entirely by the SDK's own bounded default retry policy
  (`Schedule.recurs(8)`, honoring a `429`'s `Retry-After`); this family adds no retry logic of its
  own. Credentials are `DISCORD_BOT_TOKEN`/`DISCORD_TOKEN`, read at call time through the SDK's own
  `CredentialsFromEnv`, never a prop.

  Walked read-only against the live target, `hf-discord-halibut.service` on CT100: the bot
  self-registers nine guild-scoped commands at every startup (Sapphire's `BulkOverwrite`), so
  `docs/discord.md` documents the ownership conflict and the handover sequence rather than
  declaring `Discord.GuildApplicationCommand` against Halibut's own guilds — that would fight the
  bot's own registration, not replace it. Guild roles, channels and webhooks are not built: Halibut
  uses none of them (measured on CT100), and the engine in `resource.ts` generalizes cleanly to a
  future spec file if a stack ever needs one.

  SDK gaps recorded in `docs/discord.md`: every generated operation's typed error union is narrower
  than the protocol's own status map (`Forbidden`/`NotFound`/`BadRequest`/`Conflict` are built at
  runtime but not in the exported type — measured via `tsc`, not assumed); `options` is passed
  through opaquely rather than re-modeled from the ~40-type generated union; there is no vendor
  constraint table (unlike NetBox/Paperless); global command propagation (up to an hour, Discord's
  own docs) is not polled.

## 0.30.0

### Minor Changes

- [#229](https://github.com/taslabs-net/homeflare-kit/pull/229) [`b4d714e`](https://github.com/taslabs-net/homeflare-kit/commit/b4d714eff527c8c875afca2cb529d5f312bd1efa) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Added `caddy/formatCaddyfile(text)`: pipes a Caddyfile through the LOCAL
  `caddy fmt -` binary (stdin in, formatted text out) — the same formatter the
  `caddy fmt` CLI command runs. There is no admin API endpoint for this
  (`cmd/commandfuncs.go` is CLI-only), so it shells out with
  `ChildProcessSpawner` (S19) rather than going through `@distilled.cloud/caddy`,
  and it never reimplements the formatter in TypeScript: a missing or failing
  binary fails the Effect with a typed `CaddyFmtNotFound` / `CaddyFmtFailed`,
  it never silently returns the input unformatted.

  Also: `Caddy.Config`'s plan (`diffConfig`) and deploy (`CaddyConfigProvider`'s
  `reconcile`) now surface the adapter's "Caddyfile input is not formatted"
  warning as its own clear line naming the fix, separately from any other
  adapter warnings — it used to be silent at plan time, and just another line
  in the pile at deploy time. Nothing here changes what gets loaded onto Caddy:
  formatting should never change the adapted JSON digest.ts compares (reasoned
  from the Caddyfile grammar; not measured against a real Caddy in this
  package — see docs/caddy-fmt.md).

- [#226](https://github.com/taslabs-net/homeflare-kit/pull/226) [`bfc71a3`](https://github.com/taslabs-net/homeflare-kit/commit/bfc71a31e811aab0ccdbbc5ce82ee6803c7ad277) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add the Google Workspace provider family (`@homeflare/alchemy/google-workspace`): `Group`,
  `GroupMember`, `DomainAlias` and `OrgUnit` over the Admin SDK Directory API, built on
  `@distilled.cloud/google-workspace@1.0.0-rc.12`'s typed `admin_directory_v1` operations
  (S23 — no hand-rolled client). Adopt-first by get-by-key, `retain` on removal for everything
  but membership, and no `User` resource (Google's own `User` schema carries a `password` field).
  Credential setup — domain-wide delegation, the least OAuth scopes each resource needs, and
  where the service-account key lives in OpenBao — is in
  `packages/alchemy/docs/google-workspace.md`.

- [#225](https://github.com/taslabs-net/homeflare-kit/pull/225) [`a68c021`](https://github.com/taslabs-net/homeflare-kit/commit/a68c0212f951d3492e5fde981f7f334f777d21fe) Thanks [@taslabs-net](https://github.com/taslabs-net)! - New family: `@homeflare/alchemy/grafana`. `Grafana.Datasource` declares one data source, keyed by
  `uid`, calling `@distilled.cloud/grafana`'s typed `addDataSource`/`getDataSourceByUID`/
  `updateDataSourceByUID`/`deleteDataSourceByUID` operations, `catchTag('NotFound', ...)` in place of
  a status check. Credentials are a `GrafanaTarget` (instance origin + a token env var NAME, never a
  literal value) resolved lazily per call, parameterized per instance rather than fixed like
  Forgejo's — this estate runs more than one Grafana. `grafanaProviders(target)` composes the
  provider with its credentials, mirroring `litellmProviders`.

  Only `Datasource` ships: `@distilled.cloud/grafana@1.0.0-rc.12` has no create/update/delete
  operations for folders, dashboards, alert rules or contact points, measured against its published
  types — recorded in `docs/grafana.md` and `docs/upstream-conformance.md` rather than worked
  around with a hand-rolled client for the missing pieces.

  Built and measured, read-only, against the live target `teslamate-grafana.service` on CT100
  (Grafana 13.1.3, `teslamate/grafana:4.2.0`): one file-provisioned datasource, image-baked
  dashboards, no folders, alert rules or contact points. No stack yet imports this subpath.

## 0.29.1

### Patch Changes

- [#223](https://github.com/taslabs-net/homeflare-kit/pull/223) [`dc37600`](https://github.com/taslabs-net/homeflare-kit/commit/dc37600d0bb1c72ed2711351e498949af81271c6) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `declareRepoBaseline` and `declareRepoPolicy` declared `GitHub.Repository` and their
  `RepositoryRuleset` as two independent resources with no dependency edge between them (K5,
  kit PR 216). `repoBaselineSettings`/`repoPolicy` already gate `allowAutoMerge` on
  `checks.length > 0`, but with nothing ordering the two resources, a deploy that moves a repo
  from `checks: []` to a non-empty list could apply the repository (turning auto-merge on) before
  the ruleset (adding the required check) — or the ruleset apply could fail outright, leaving
  auto-merge on with nothing required. `gh pr merge --auto` merges a CLEAN pull request the instant
  nothing is outstanding, so that window is exactly the fail-open state K5 exists to prevent.

  Both callers now thread the ruleset's `rulesetId` through `allowAutoMerge`'s own value
  (`repo-auto-merge-gate.ts`'s `gateAutoMergeOnRuleset`, via `alchemy/Output`'s `map`) whenever a
  declaration turns auto-merge on, instead of writing it as a literal. Alchemy orders resources by
  Output references in props (`Plan.ts`'s `Output.upstreamAny`, `Apply.ts`'s `waitForDeps` —
  see the kit's own `alchemy-output-refs-order-resources` memory), so this makes the engine apply
  the ruleset first, with no change to the value actually sent (`allowAutoMerge` is still exactly
  `true`). A ruleset apply failure now leaves the repository's `reconcile` — and `allowAutoMerge`
  — untouched, proved by a new engine-level ordering test and failure test for each caller.

  The reverse transition (checks/approvals removed) needs no matching edge: neither caller ever
  declares a rule's removal explicitly, only omits it, and `repository-ruleset-guards.ts`'s
  `requiredChecksOmissionRefusal`/`undeclaredLiveRuleRefusal` already refuse — regardless of apply
  order — to drop a still-live required rule by omission.
