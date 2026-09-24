# Alchemy changelog archive 10

[Current changelog](../../CHANGELOG.md) · [Archive index](./README.md)

- [#191](https://github.com/taslabs-net/homeflare-kit/pull/191) [`e991225`](https://github.com/taslabs-net/homeflare-kit/commit/e9912254041b1f15195f8a4cf2917e00a1194d43) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `packages/alchemy` now depends on `@distilled.cloud/proxmox`, aliased per
  `packages/alchemy/docs/distilled-interim.md`'s interim-package route onto
  the published `@homeflare/distilled-proxmox@0.2.0`
  (`"npm:@homeflare/distilled-proxmox@0.2.0"` in `dependencies`, not
  `peerDependencies` — the package needs it resolved, not left to whoever
  installs it). This is the follow-up PR `distilled-proxmox-interim.md`
  called out: the alias, plus `src/proxmox/distilled-task-await.test.ts`
  (ported off draft PR 182's dev-only `link:` dependency onto the real alias,
  assertions unchanged) proving `awaitTask`'s poll-until-exitstatus loop
  against a fake PVE — success only on `exitstatus` exactly `"OK"`,
  `"OK (warnings)"` fails, and a bare 400 is the non-retryable `BadRequest`
  (that last case already lives in `packages/distilled-proxmox/src/protocol.test.ts`,
  merged with the package itself).

  No existing `packages/alchemy/src/proxmox/*` resource is touched or moved
  onto the distilled package — that migration is still a separate, later PR.
  Because `@homeflare/distilled-proxmox` is also a sibling workspace package,
  bun resolves the alias to the local workspace copy rather than fetching the
  npm tarball (same unmodified code either way); that local copy has no
  prebuilt `dist` by default, and `tsc`'s `moduleResolution: "bundler"`
  follows the alias's `exports["."].types` straight to `dist/index.d.ts` when
  typechecking the new test file — `bun test` itself needs no such build
  (it resolves the package's own `bun` export condition straight to `src`).
  `packages/alchemy/package.json` gets a `pretypes` script
  (`bun run --filter '@homeflare/distilled-proxmox' build`) so `bun run
types` — and therefore `bun run check` — builds that one dependency first;
  nothing else changes.

## 0.27.2

### Patch Changes

- [#180](https://github.com/taslabs-net/homeflare-kit/pull/180) [`1a85198`](https://github.com/taslabs-net/homeflare-kit/commit/1a85198349981e04f475c0e08b0aa2a995719ef4) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The `forgejo/*` family (`Forgejo.Repository`, `Forgejo.BranchProtection`,
  `Forgejo.OrgLabel`, `Forgejo.OrgTeam`, `Forgejo.RepoWebhook`,
  `Forgejo.OrgSecret`, `Forgejo.TeamMember`) now calls
  `@distilled.cloud/forgejo@1.0.0-rc.12`'s typed operations instead of a
  hand-rolled `Effect HttpClient` client — `catchTag('NotFound', …)` in place
  of a status-carrying `ForgejoError`. `client.ts` is gone; nothing else in
  this package imported it. Credentials still resolve from `FORGEJO_URL` /
  `FORGEJO_TOKEN` at call time, now through the package's own
  `CredentialsFromEnv` layer. Every operation this family calls exists in the
  package and every error it handles carries a tag, so no distilled patch was
  needed. Props and attributes are unchanged — an adopted repository, label,
  team, webhook, branch protection rule, org secret or team membership still
  plans noop.

- [#179](https://github.com/taslabs-net/homeflare-kit/pull/179) [`0419d30`](https://github.com/taslabs-net/homeflare-kit/commit/0419d30860e4f6ffbf42e0e1257bd5845a00a418) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Cloudflare.R2BucketLock` now calls `@distilled.cloud/cloudflare/r2`
  (`getBucketLock`/`putBucketLock`) instead of the `cloudflare` npm SDK, the same
  distilled package `MeshNode` already used — `catchTag('NoSuchBucket', …)` in
  place of an `instanceof NotFoundError` status check. The `cloudflare` peer
  dependency and `client.ts` are gone; nothing else in this package imported
  them. Props, attributes and the wire body are unchanged — an adopted lock
  still plans noop.

## 0.27.1

### Patch Changes

- [#177](https://github.com/taslabs-net/homeflare-kit/pull/177) [`615d7f0`](https://github.com/taslabs-net/homeflare-kit/commit/615d7f0f081828a64f2c334ce423324f10e13921) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `launchd-ports.md` and `port-claims.ts`'s header comment no longer cite the
  house monorepo's path and a pinned commit as the source of the port-collision
  rule; both now state it as the kit's own rule, matching the estate's existing
  port-collision strictness on its own terms. No behavior change.

## 0.27.0

### Minor Changes

- [#175](https://github.com/taslabs-net/homeflare-kit/pull/175) [`7767e82`](https://github.com/taslabs-net/homeflare-kit/commit/7767e82d18e74af203ccae108b8e4f3de99be724) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `GitHub.RepositoryRuleset`, a bridge resource under `@homeflare/alchemy/github` that
  probes for an existing same-named ruleset by name before creating one (closing the
  duplicate-ruleset hazard in upstream `alchemy@2.0.0-beta.79`'s `GitHub.Ruleset`) and
  normalizes before comparing so a matching live ruleset is a true noop. Also adds
  `declareRepoBaseline`, and rewires `declareRepoPolicy`'s ruleset half onto the new
  resource — `builds` is the only caller, and its ruleset has never been created, so this
  changes no live resource's identity.

  Versions this was walked against: `alchemy@2.0.0-beta.79`, `@octokit/rest@22.0.1`,
  `@octokit/openapi-types@27.0.0` (the version the REST method parameter types actually
  resolve through — see `repository-ruleset-constraints.ts` for the version-chain note).

## 0.26.0

### Minor Changes

- [#171](https://github.com/taslabs-net/homeflare-kit/pull/171) [`66e6e03`](https://github.com/taslabs-net/homeflare-kit/commit/66e6e03060b0cebbf0e326e6f2880f196735fba7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `sshSudoRunner()` to `@homeflare/alchemy/linux` — the Linux twin of the launchd subpath's
  `sudoRunner()`, for a host stack whose ssh user is not root but has passwordless sudo
  (`(ALL) NOPASSWD: ALL`). The deploy runs as the operator, and only a fixed allowlist of absolute
  `sudo -n` calls elevates: `install`→`mv` (GNU `install` writes through its destination, so this
  runner stages, installs into a derived temp file, then `mv`s it into place — a rename(2), atomic
  by construction), `rm`, `mkdir`/`chmod`/`chown`/`rmdir` for `Host.Directory`, and
  `daemon-reload`/`enable`/`disable`/`start`/`stop`/`restart` for `Systemd.Unit` and
  `Systemd.Timer` (gated by each unit's own `FragmentPath`, so a vendor unit like
  `pveproxy.service` stays unreachable). Every privileged argv is logged before it runs; a plan
  never elevates (`checkWrite` and every read stay on the operator); the host guard reads the whole
  directory chain from `/` down to the target in one `ls -ldn` call, refusing anything not
  root-owned, group/other-writable, ACL-flagged, or the wrong kind. See
  `packages/alchemy/docs/linux-sudo.md` for the full argv table and what is measured versus
  reasoned — write paths are reasoned, not run live; construction and `checkWrite` were exercised
  read-only against a real Debian 13 / trixie host (systemd 257.13-1~deb13u1, coreutils 9.7-3),
  confirming nothing is elevated by a plan.

  homeflare-proxmox's first consumer: a script, systemd service and timer declared per Proxmox
  node with `sshSudoRunner({ host, prefixes: ['/usr/local/bin', '/etc/systemd/system'] })`.
  Groundwork from PR 132 (`src/linux/sudo-listing.ts`, the `ls -ldn` chain reader) is now used
  directly by the new guard rather than left unreferenced.

## 0.25.1

### Patch Changes

- [#168](https://github.com/taslabs-net/homeflare-kit/pull/168) [`f5b8dcf`](https://github.com/taslabs-net/homeflare-kit/commit/f5b8dcf7e5875f1f5f589a73139fa58d8d886a43) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fix `Systemd.Unit`: for a unit declared `started: false`, `ActiveState=activating` no longer
  reads as drift. A timer-driven `Type=oneshot` service (no `[Install]`; its `.timer` starts it)
  reports `activating` for the whole duration of its run, not an instant — so a plan taken
  mid-run used to show `update`, and a deploy would `systemctl stop` a check that was already
  running. Now only `ActiveState=active` counts as drift for `started: false`; `started: true`
  (the default) is unchanged. `activating` with `SubState=auto-restart`/`auto-restart-queued` —
  systemd's crash-restart backoff, not a fresh start — is excluded from that exemption and still
  counts as drift, so a crash-looping unit declared `started: false` is still stopped. Both
  `diffUnit` (unit-lifecycle.ts) and `settle` (unit-settle.ts) now share one predicate,
  `isUnitRunning` (unit-form.ts), so they can never disagree about it.

## 0.25.0

### Minor Changes

- [#163](https://github.com/taslabs-net/homeflare-kit/pull/163) [`cf301fb`](https://github.com/taslabs-net/homeflare-kit/commit/cf301fba5196056938419140e80754dc7bf34991) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `@homeflare/alchemy/paperless`: `Tag`, `DocumentType`, `StoragePath` and `CustomField` —
  Paperless-ngx's taxonomy, create-or-update and never deleted by default — generated from
  Paperless-ngx **3.1.1**'s own served OpenAPI document (API version **10**, sha256 `d0fe550d…`).
  Types (`generated/types/*.ts`) and constraint tables (`generated/constraints/*.ts`) are both
  generated by the new `bun codegen/paperless.ts`, which also introduces
  `codegen/openapi-types.ts` (a component-to-TypeScript emitter over `openapi.ts`'s `JsonSchema`)
  and `codegen/dialects.ts` (the regex-dialect-plus-anchoring table `codegen/netbox.ts` now reads
  too, unchanged).

  Every create sends `owner` (null when undeclared) — Paperless-ngx's `OwnedObjectSerializer`
  defaults an absent `owner` to the token user, so omitting it the way an undeclared NetBox
  foreign key is omitted would create a second, invisible row on every deploy. `read` answers
  `Unowned` on every match rather than adopting silently (H1). A `CustomField.dataType` change is
  refused at plan time — never a PATCH, never a replace — because either one deletes that field's
  value on every document.

## 0.24.0

### Minor Changes

- [#157](https://github.com/taslabs-net/homeflare-kit/pull/157) [`2a69523`](https://github.com/taslabs-net/homeflare-kit/commit/2a69523410521f8373d2c216070f788df0ca2a64) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `LiteLLM.PassThroughEndpoint` to `@homeflare/alchemy/litellm`, the kit's first LiteLLM
  resource: one row of LiteLLM's `/config/pass_through_endpoint` family, a route on the proxy that
  forwards requests to an upstream target. Types are generated from LiteLLM **1.100.0**'s own
  OpenAPI document (tag `v1.100.0`, commit `e4f25265704e2b2c6cf6e81be2e4c5cffff896f4`), dumped the
  way the vendor's own CI dumps it — `prisma generate` against `litellm/proxy/schema.prisma`, then
  the `dumpSpec` program embedded in `ui/litellm-dashboard/scripts/gen-api-types.mjs`, run with
  `app.routes`' `include_in_schema` forced `True` the way the dashboard's generator does — because
  the reference proxy's `/openapi.json` could not be reached when this was walked (jetsam restart
  loop). Cross-checked byte-identically: regenerating with `openapi-typescript@7.13.0` reproduces
  the tag's committed `ui/litellm-dashboard/src/lib/http/schema.d.ts` exactly, sha256
  `8bc5d9c9…40b83f9`, 2,334,248 bytes on both sides. The dump itself is sha256
  `1b3e4d23…4b006399f` (`codegen/manifest.json`'s `litellm-openapi` entry).

  Every pass-through endpoint lives in one `general_settings.pass_through_endpoints` field — every
  create, update and delete is a read-modify-write of the whole list — so every mutating call is
  wrapped in a per-base-URL `Effect` semaphore, and `reconcile` reads back after writing rather
  than trusting the call that just returned. A path already held by a `config.yaml` entry
  (`is_from_config: true`) is refused at plan rather than silently overridden; a foreign DB row on
  the same path is `Unowned` and needs `--adopt`; a literal secret in a forwarded `Authorization`,
  `x-api-key` or `cf-aig-authorization` header is refused unless it carries LiteLLM's own
  `os.environ/NAME` reference form. Clearing `timeout`, `methods` or `guardrails` is planned as a
  replace (delete then create), because LiteLLM's update route merges with `exclude_none` and can
  never clear an already-set field. Credentials (`LITELLM_PROXY_URL`, `LITELLM_PROXY_API_KEY` —
  LiteLLM's own variable names) are read fresh from the environment on every call, never a prop.

  Deferred: the Claude OAuth model, key and team slice, which needs estate answers only Tim can
  give. See `docs/litellm.md`.

- [#156](https://github.com/taslabs-net/homeflare-kit/pull/156) [`6b4b58c`](https://github.com/taslabs-net/homeflare-kit/commit/6b4b58c9a207dd4351d80e514ee4b7d09cc74ea0) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Create-and-assert a database on a self-hosted cluster: `Postgres.Database` in the new
  `@homeflare/alchemy/postgres` subpath. Walked against PostgreSQL 18.6 (`REL_18_6`, commit
  `724edf9b`) — upstream `alchemy@2.0.0-beta.79` has vendor-API Postgres resources (Planetscale,
  Neon, Prisma, Fly, Railway) and a runtime binding over `@effect/sql-pg`, but nothing for a
  database you run yourself, so this builds on that same `@effect/sql-pg` `PgClient` upstream's
  own `alchemy/SQL/Postgres` uses (new optional peer, `@effect/sql-pg@4.0.0-rc.115`).
