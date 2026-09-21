# @homeflare/alchemy

## 0.7.0

### Minor Changes

- [#72](https://github.com/taslabs-net/homeflare-kit/pull/72) [`294518d`](https://github.com/taslabs-net/homeflare-kit/commit/294518dc205c1981bf8f48aaf087bdb3869d4123) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Rename safety for `BaoPolicy`, `BaoCloudflareRole` and `BaoProxmoxRole` in `@homeflare/alchemy/openbao`.

  Behaviour changes:

  - A changed `name` on `BaoPolicy`, or a changed `mount` or `name` on `BaoCloudflareRole` or `BaoProxmoxRole`, now plans `replace`. Before, it planned `update`: the new object was written and the old one stayed live with no state record, even under `RemovalPolicy.destroy()`. Now the old one is deleted after the new one is written, or kept under the default `retain`, and the apply says so.
  - `BaoPolicy` compares names the way OpenBao stores them, trimmed and lowercased, so a change of case is not a rename.
  - A `BaoProxmoxRole` rename that also changes `mintUser` now fails the plan unless `allowMintUserChange` names the old mint user, the same rule an in-place re-scope already had.
  - A rename or move onto a name or path that already exists live now fails the plan, before anything is written. Without this, two policies or roles that swapped names under `RemovalPolicy.destroy()` both planned `replace` and ended with both deleted. The check also applies under `retain`, because a diff cannot see the removal policy: a swap, or a move back onto a retained old generation, now takes two deploys through a free name, or removing the target by hand.
  - When the new name is an Output that is not known until apply, reconcile now refuses the `update` before writing anything. The next deploy plans `replace`. A `BaoProxmoxRole` rename whose `allowMintUserChange` is still an Output defers the same way instead of failing the plan.

  The rename is checked even while other props are still pending Outputs. `src/openbao/REPLACE.md` has the measured engine behaviour and what `retain` leaves live for each of the three.

- [#70](https://github.com/taslabs-net/homeflare-kit/pull/70) [`8cafb48`](https://github.com/taslabs-net/homeflare-kit/commit/8cafb48d84a9734997d7562311801025f2fa4236) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add the `@homeflare/alchemy/caddy` subpath: a running Caddy's config, declared as Caddyfile text and applied through Caddy's own admin API.

  - `CaddyConfig` / `CaddyConfigProvider` (`Caddy.Config`): the whole Caddyfile as one prop. Apply is `POST /adapt` (validate), `POST /load` with `text/caddyfile` (graceful reload), then `GET /config/`, which must hash to the adapted config, or the deploy fails. When Caddy refuses a config, it keeps the old one, and the error gives Caddy's reason and confirms whether the old config is still running. This includes Caddy's refusal that arrives in a 200 response after adapter warnings. Drift compares SHA-256 digests of canonical adapted JSON: declared, live and stored. A hand edit or a restart with a different file plans an update. A plan-time `/adapt` fails the plan on a bad Caddyfile. With no state, a running Caddy is adopted. `replace` is never planned. Delete never unloads or stops Caddy, and `retain` is the default.
  - `caddyWithFile()`: the same Caddyfile is also written with launchd's `HostFile` to the file Caddy starts from, so a restart keeps it. The file is written first, then `/load`, and both are retained. `sourceFile` is sent as `Caddy-Config-Source-File` so SIGUSR1 reload-from-file keeps working. `docs/caddy.md` covers the order, `--resume`/autosave and the refused-config window.
  - `CaddyAdmin`, `localCaddyAdmin()`, `caddyAdminLayer()` and `caddyProviders()`: every admin call goes through one injectable transport. The local transport uses `node:http` on both Bun and Node, accepts only loopback `http://` or `unix://`, and sends `Host`/`Origin` the way the Caddy CLI does. `hostHeader` covers narrowed `origins` and SSH-forwarded ports. It retries only refused connections and then rejects with `CaddyUnreachableError`. A stopped Caddy does not fail the plan, because its launchd job may be the fix: read and diff plan the load with a warning, and the apply fails until Caddy answers.
  - Refused before anything is sent: an empty Caddyfile or one that adapts to no apps; literal secrets (a PEM key, a literal after `dns <provider>`, secret-named subdirectives, literal `Authorization` headers, token and password-hash shapes, and a `{$NAME:default}` whose default is one of these); and an adapted `admin` block that would turn the API off, move it off loopback or away from the transport (another port, socket or loopback address, or no address at all when the transport is not at Caddy's default), allow no Host the transport sends, set `enforce_origin` over a unix socket, enable `remote`, or pull config. Secrets go in `{env.NAME}` or `{file./path}` placeholders.

- [#71](https://github.com/taslabs-net/homeflare-kit/pull/71) [`73736ae`](https://github.com/taslabs-net/homeflare-kit/commit/73736aec0a686af36cb4ef7ecfba42d40e543fc7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `MeshNode` (`Cloudflare.MeshNode`) and `fetchMeshNodeToken` to `@homeflare/alchemy/cloudflare`.

  - **`MeshNode`** declares a Cloudflare Mesh node (a `warp_connector`) with `name` and `ha`. It never reads the node token, so the token never reaches Alchemy state. Alchemy's `Cloudflare.Tunnel.WarpConnector` fetches it on every read and stores it, and it has no `ha`. The attributes are `id`, `accountId`, `name`, `status` and `ha`.
    - A `name` change renames the node in place (`PATCH`), keeping its id, token and enrolled replicas.
    - `ha` is required and create-only (Cloudflare: "cannot be changed afterward"). A change replaces the node: delete-first while the name stays (names are unique per account), create-first when the name changes too. An account change is a create-first replace.
    - **It defaults to `RemovalPolicy.retain`**, like the kit's other resources whose deletion breaks their consumers: deleting a node cuts every enrolled replica off the Mesh, and a new one means a new token and Mesh IPs. Dropping the declaration or `alchemy destroy` leaves the node live. Opt in with `.pipe(RemovalPolicy.destroy())`.
    - Under that default a same-name `ha` change **refuses and writes nothing**: the engine keeps the old node, which still holds the name, and a create never reuses a node it did not create (that would record the wrong `ha`). The sentence names the ways on: deploy once with `.pipe(RemovalPolicy.destroy())` (delete-first), delete the old node by hand, or keep it (`alchemy state rm` the row, then `adopt(true)`; reverting `ha` alone refuses again). A create-first replace leaves the old node live. When a create-first replace's new name is already held by another node, the sentence does not call it the old node and says not to delete it. Every way back from inside a replace starts with `alchemy state rm`, because `adopt(true)` alone does not act on a `replacing` row; the 1013-retry sentence says so too. All measured through Alchemy's real plan/apply against the fake.
    - A door (a node with no routes) is documented as `ha: false`: HA fails over routes, and each replica has its own Mesh IP. A second door is a second `MeshNode`.
    - An existing node is adopted by exact name and returned `Unowned`. A create answered code 1013 after a clean lookup (distilled retries a create whose response was lost) names the node that appeared rather than blaming another tunnel type.
    - `list` is empty and `nuke` skips the type, because Alchemy's WarpConnector already lists every `warp_connector`.
  - **`fetchMeshNodeToken({ accountId, id | name })`** returns the node token `Redacted`, on demand, for a one-off enrolment step. Callers write it to a root-owned `0600` file on the node and nowhere else. An empty token fails, and a 403 names the Write permission the endpoint needs. Before any request it refuses the Global API Key, an empty API token, and a set `DISTILLED_DEBUG_HTTP` (distilled would print the token to stderr).
  - Built on `@distilled.cloud/cloudflare`, the SDK Alchemy's own Cloudflare providers use. The `cloudflare@4.5.0` SDK cannot create an HA node. It is a new **required peer**, pinned to the version alchemy pins (`1.0.0-rc.12`): add it to your install line.
  - `providers()` now also resolves Alchemy's Cloudflare credentials and account for `MeshNode`, the same way `Cloudflare.providers()` does (a profile, or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`).

  Guide: `docs/mesh-node.md`.

## 0.6.0

### Minor Changes

- [#67](https://github.com/taslabs-net/homeflare-kit/pull/67) [`48163cf`](https://github.com/taslabs-net/homeflare-kit/commit/48163cfc83ad7deac8720be2e8fb7fe964ade7a3) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add to `@homeflare/alchemy/openbao`:

  - **`BaoJwtRole`**: roles on `jwt` and `oidc` mounts.
  - **`BaoKubernetesRole`**: roles on `kubernetes` mounts. `aliasNameSource` is required, because changing it on a live role moves every pod to a new entity.
  - **`BaoJwtAuthConfig`**: the non-secret config of a JWT-validating mount. It deliberately has no OIDC client secret, and it refuses a mount that has one, because its full-replace write would erase it.
  - **`BaoMfaTotpMethod`** and **`BaoMfaLoginEnforcement`**: login MFA. A TOTP method is found by name. Renaming one is refused, because a rename would strand every enrolled secret. A name already held by another MFA method type is refused too, because the write would convert that method. Deleting an enforcement is refused, because in OpenBao 2.6.2 the delete comes back after a restart (openbao/openbao#4030).
  - **`assertBaoIdentity`** (with `assertBaoIdentityEffect` and `BaoIdentityError`): refuses to proceed unless unauthenticated `sys/health` reports the expected `cluster_name` and the namespace is the expected one.
  - **`hostAppRoles`**: a pure generator that makes one AppRole per host, named `<class>--<host>`. It refuses a secret_id TTL of 0.

  Behaviour changes:

  - A changed `path` on `BaoMount` or `BaoAuthMethod` now **fails the plan** unless the new `remountFrom` prop names the old path. With `remountFrom`, the mount is moved with `sys/remount`, keeping its data (leases under it are revoked). Before, the plan answered `update` and enabled an empty mount at the new path.
  - A changed `name` on `BaoAuthRole`, or a changed `name` on `BaoPkiRole`, now plans `replace`. Before, it answered `update` and left the old role live with no state record.
  - `BaoPkiRole` now manages `requireCn`, `enforceHostnames`, `keyUsage`, `allowedDomainsTemplate`, `noStore` and `generateLease`, defaulting to OpenBao's own values. Its full-replace write already reset these fields silently, so a role whose live values differ from those defaults now plans `update` instead of being reset unseen. `noStore` together with `generateLease` is refused.

  See `src/openbao/REPLACE.md` for what every family does on a rename.

- [#68](https://github.com/taslabs-net/homeflare-kit/pull/68) [`b023bae`](https://github.com/taslabs-net/homeflare-kit/commit/b023bae8f20d6aa33239107dc0538750efc466ca) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add the `@homeflare/alchemy/launchd` subpath, so a Mac host can be declared with Alchemy.

  - `LaunchdJob` / `LaunchdJobProvider` (`Launchd.Job`): one launchd job in the `system` domain or a `gui/<uid>` domain. The provider renders the plist itself, writes it atomically to the derived path (`/Library/LaunchDaemons` or the user's `LaunchAgents`) and drives `launchctl`. Create bootstraps; update writes, boots out and bootstraps (a restart); read uses `launchctl print`; diff compares the rendered plist's SHA-256 with the stored and on-disk digests. Replace happens only on a `label` or `domain` change, delete-first — so everything the new job would be refused for is refused at plan time, while the old job still runs, and a rename is seen even while other props are unresolved. A label another job already holds is never booted out or overwritten. A failed first bootstrap removes the plist it wrote. A disabled label is refused, not re-enabled. Labels under `org.nixos.`, `com.apple.` and `homebrew.mxcl.` are refused; `docs/launchd.md` describes the nix-darwin cutover.
  - `HostFile` / `HostFileProvider` (`Host.File`): a text file with mode, owner and group. It is written atomically (temp file, then rename), diffed by SHA-256, mode and owner, and refused over a symlink, a directory, or a different file at a new path.
  - `HostRunner`, `localRunner()`, `hostRunnerLayer()` and `launchdProviders()`: every filesystem and `launchctl` call goes through one injectable runner. The local runner never elevates. System-domain writes are refused unless the deploy runs as root or the runner is explicitly `privileged`.
  - `renderPlist`: a small, deterministic XML plist serializer, round-tripped through `plutil` in the tests.

  Props are stored unencrypted in Alchemy state, so `environment`, `programArguments` and file `content` must not hold secrets. A tripwire refuses the obvious cases; secret files stay rendered by openbao-agent, and the stack declares only their path. Anything already on the host is read as `Unowned`, so it is never adopted without `--adopt`.

## 0.5.0

### Minor Changes

- [#64](https://github.com/taslabs-net/homeflare-kit/pull/64) [`3ed9771`](https://github.com/taslabs-net/homeflare-kit/commit/3ed977142ffe2fe6dd02359a3a87b1a0a84c9952) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `appRoleLogin` / `revokeSelf` (with `appRoleLoginEffect`, `revokeSelfEffect` and `BaoLoginError`) to `@homeflare/alchemy/openbao`, so wrapper scripts can log in with an AppRole and revoke on exit. They use the same address resolution and transport as the `Bao.*` families. The login never sends `BAO_TOKEN`, and error strings are redacted, because OpenBao 2.6.2 can echo a secret_id back in an error. `clientToken` is a getter over a private field, so printing or serialising the result does not show the token under Bun or Node.

  Add `BaoPlugin` / `BaoPluginProvider` for the plugin catalog (`sys/plugins/catalog/<type>/<name>`). It has no `env` prop and retains on destroy. It refuses to shadow a builtin or overwrite a declarative entry, and it names the fix when an unversioned registration is filed under the binary's self-reported version.

  Fix `BaoSshRole` writes. `default_extensions` and `default_critical_options` were sent as JSON strings. OpenBao's field validation rejects that with a 400, so every role write failed. They are now sent as objects.

## 0.4.1

### Patch Changes

- [#62](https://github.com/taslabs-net/homeflare-kit/pull/62) [`93b7107`](https://github.com/taslabs-net/homeflare-kit/commit/93b71070b1a64701cadc1a547044a3ec4da26a50) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Export TB4 control-plane Resource constructors from `@homeflare/alchemy/proxmox` (Storage, SDN, access, HA, backup, metrics, PBS). Guests and NIC apply stay Provider-only.

## 0.4.0

### Minor Changes

- [#60](https://github.com/taslabs-net/homeflare-kit/pull/60) [`df34d27`](https://github.com/taslabs-net/homeflare-kit/commit/df34d2750fca4a2b6b86490ddb0a819c12f9ea39) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `BaoAuthMethod` so a stack can enable `approle` (or jwt/oidc) instead of running `configure-engines`. Metadata only — no role ids or OIDC secrets. File audit stays out: OpenBao 2.6 file audit is config-only.

## 0.3.2

### Patch Changes

- [#58](https://github.com/taslabs-net/homeflare-kit/pull/58) [`e7c101f`](https://github.com/taslabs-net/homeflare-kit/commit/e7c101faada2b14466a1f0bbf1f93da46e5e06cb) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Bump Alchemy to 2.0.0-beta.79. Effect stays rc.115. 79 starts Bun with production JSX (the `jsxDEV` CLI crash on 78) and declares `mime` on cloudflare-runtime; the `mime` peer stays so existing consumer installs do not drop a required line.

## 0.3.1

### Patch Changes

- [#56](https://github.com/taslabs-net/homeflare-kit/pull/56) [`5f41ad7`](https://github.com/taslabs-net/homeflare-kit/commit/5f41ad7ab59375e42bb4757dd5b4b81f4a7b6cd9) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Export `BaoPkiRole` and `BaoSshRole` from `@homeflare/alchemy/openbao`. The barrel already shipped both providers; stacks constructing either role had to import the resource from internals.

## 0.3.0

### Minor Changes

- [#54](https://github.com/taslabs-net/homeflare-kit/pull/54) [`d526365`](https://github.com/taslabs-net/homeflare-kit/commit/d526365a51deac968e5b0076e88b2e68b866534f) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Bump Alchemy to 2.0.0-beta.78 and Effect to 4.0.0-rc.115. Consumers must move the override set with it — Alchemy 78's peer is `effect >= rc.115`. Effect rc.115 renamed `Config.redacted` to `Config.Redacted`. `mime@4.1.0` is now a required peer: Alchemy's cloudflare-runtime imports it and does not declare it.

## 0.2.2

### Patch Changes

- [#46](https://github.com/taslabs-net/homeflare-kit/pull/46) [`9bc37f8`](https://github.com/taslabs-net/homeflare-kit/commit/9bc37f8bd7b9af1fd5c62cc4bc48597251ef61ab) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Export `BaoMount` and `BaoAuthRole` from `@homeflare/alchemy/openbao`.

  The docs already showed `import { BaoMount } from '@homeflare/alchemy/openbao'`, but the barrel only shipped the providers. Stacks constructing those resources had to import from internals.

- [#48](https://github.com/taslabs-net/homeflare-kit/pull/48) [`4967118`](https://github.com/taslabs-net/homeflare-kit/commit/4967118cc887faba34b17cd48588102736be49bb) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Export `BaoCloudflareRole` and the Cloudflare role catalog helpers from `@homeflare/alchemy/openbao`, and retry dropped OpenBao transports.

  Stacks declaring mint roles need the resource constructor plus `parseRolesConfig` / `expandAll` / `permissionGroupsFromEngine`. The barrel previously shipped only `BaoCloudflareRoleProvider`. A 585-role plan against a Mesh-fronted vault died mid-diff with an empty transport error; status-0 calls now retry twice.

## 0.2.1

### Patch Changes

- [#40](https://github.com/taslabs-net/homeflare-kit/pull/40) [`60c90eb`](https://github.com/taslabs-net/homeflare-kit/commit/60c90eb4682d0ded2597a79033159ab71cc7a649) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Pin `rolldown` in the consumer overrides so an unlocked install cannot float a missing tarball.

  Alchemy's optional peer `vite@^8` depends on `rolldown: ~1.2.6`. A consumer `bun add`
  (no lockfile) resolved that to 1.2.9; npm listed the version and 404'd
  `rolldown-1.2.9.tgz`. Main CI failed on that fetch after [#39](https://github.com/taslabs-net/homeflare-kit/issues/39). The override holds 1.2.8 —
  the last tarball a green smoke actually installed.

## 0.2.0

### Minor Changes

- [#36](https://github.com/taslabs-net/homeflare-kit/pull/36) [`cff4111`](https://github.com/taslabs-net/homeflare-kit/commit/cff4111c2f4461a45be5811547125b1f5d98c6d2) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Ship the HTTP and Website SDK surfaces apps were hand-rolling.

  **`@homeflare/kit/openapi`** — `createOpenApiApp()` is OpenAPIHono with one
  readable validation hook. The document and the request share a Zod schema.
  Subpath, not the main entry: a Node script that only wants `parseEnv` must not
  resolve Hono. Peers: `hono`, `@hono/zod-openapi`, `zod` (optional). Import `z`
  from `@hono/zod-openapi`.

  **`astroWebsite` / `viteWebsite`** on `@homeflare/alchemy/cloudflare` — house
  flags on Alchemy's own stacks. Astro gets `disable_nodejs_process_v2` (workerd
  process-v2 returns `[object Object]`). Vite is TanStack Start / static Vite.
  Not Nextjs: that helper hashes source and plans as create against a live Worker.

  Catalog also pins `@tanstack/react-router` 1.170.35, `@tanstack/react-start`
  1.168.52, `@tanstack/react-query` 5.102.8 — match these, do not wrap them.

## 0.1.3

### Patch Changes

- [#32](https://github.com/taslabs-net/homeflare-kit/pull/32) [`5cc2cd6`](https://github.com/taslabs-net/homeflare-kit/commit/5cc2cd62241f926aace1646fd3a1e0057e96cddd) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `accessIdentity` (ctx.access) and RFC 9728 MCP discovery; fix three doc defects.

  An app team reviewed the published packages before adopting and was right on every point.

  **`accessIdentity(ctx)` — Access identity without parsing a JWT.** Cloudflare attaches the
  authenticated identity to the execution context (shipped 2026-08-14), so a Worker behind
  Access reads `ctx.access.getIdentity()` with no token handling. The kit only offered
  `verifyAccessJwt`, which is the older path.

  ⛔ Both stay, because they are not alternatives: `accessIdentity` for a Worker behind
  Access, `verifyAccessJwt` for an origin that has no `ctx.access` — service-to-service, a
  non-Worker origin, or a Worker reached by service binding, since **`ctx.access` does not
  propagate through bindings**.

  ⚠️ Read groups from `accessIdentity`, not from a token: Cloudflare trims the JWT's
  `custom` claim at roughly 1 KB _silently_, so token-read group membership can be
  incomplete — an authorization bug that only appears for users in many groups.

  **`serveMcpMetadata` / `unauthorizedResponse` — RFC 9728.** The MCP spec requires a server
  to publish Protected Resource Metadata _and_ a 401 naming it in `WWW-Authenticate`.
  Publishing the document while answering a bare 401 leaves clients that follow the header
  with nowhere to go.

  **Three documentation defects, all reported and all real:**

  - `@homeflare/alchemy`'s README documented `@homeflare/alchemy/providers`, which does not
    exist. The real path is `/cloudflare`.
  - `@homeflare/cloudflare`'s npm description advertised "typed bindings" — it exports none.
  - `@homeflare/kit`'s advertised "logging" — `log` lives in `@homeflare/cloudflare`.

  **Packing no longer edits a manifest on disk.** `packForPublish` stripped `scripts` and
  `devDependencies` from the real `package.json`, packed, then restored it — which is a race
  when two smoke tests pack the same workspace dependency in parallel. It destroyed
  `@homeflare/kit`'s `scripts` block during this branch, _after_ `verify` had passed. The
  strip now happens inside the packed tarball, so nothing in the repository is written to.

## 0.1.2

### Patch Changes

- [#29](https://github.com/taslabs-net/homeflare-kit/pull/29) [`72f0787`](https://github.com/taslabs-net/homeflare-kit/commit/72f0787952b3a71bb6573476918e79117250409e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `cloudflare` is a required peer, not an optional one.

  Measured 2026-09-16 against the published 0.1.1 in a clean consumer install: importing
  `@homeflare/alchemy/cloudflare` without it throws `Cannot find package 'cloudflare'`.
  Marking it optional claimed the subpath would degrade gracefully; it does not load at all.
  An optional peer should mean a _feature_ is absent, not that an import fails.

  ⛔ **Why this got through, and what now stops it.** The README's pinned install command and
  the smoke test's install command disagreed — the smoke test installed `cloudflare`, the
  README never mentioned it, and nothing compared the two. So the gate proved an install no
  consumer would ever perform.

  `tests/peers.test.ts` now asserts the manifest, the README and the smoke script agree:
  every declared peer appears in all three, peers are pinned rather than ranged, and none is
  marked optional.

## 0.1.1

### Patch Changes

- [#27](https://github.com/taslabs-net/homeflare-kit/pull/27) [`5b73400`](https://github.com/taslabs-net/homeflare-kit/commit/5b73400e7fc2dd8e28a0368db3e5aa105ebdde9a) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fix the peer contract: 0.1.0 installed cleanly and threw at import.

  Measured 2026-09-16 against the published 0.1.0 in a clean consumer install — three
  defects, none of which failed at install time:

  1. **`@effect/platform-node` was a devDependency**, so a consumer got
     `Cannot find module '@effect/platform-node/NodeServices'`. Alchemy's module graph
     reaches `Cloudflare/Workers/WorkerBridge` even when you only import `/proxmox`, so it
     is a required peer, not an optional one.
  2. **The `effect` peer was ranged** `>=4.0.0-rc.112`, which resolves to rc.115 —
     `TypeError: Config.string is not a function`. Effect's rc line is not
     semver-compatible with itself, so a range is a promise this package cannot keep. Peers
     are pinned exactly now.
  3. **`@effect/platform-node-shared` still resolves up** to rc.115 against effect rc.112
     (`Cannot find module 'effect/ByteSize'`), because `platform-bun@rc.112` asks for
     `^4.0.0-rc.112`. Only a consumer-side `overrides` block holds the set together, and the
     README now says so with the exact block to paste.

  ⛔ The smoke script was `echo '…exercised by the consuming stack'` — a check that cannot
  fail, which is how all three shipped. It now packs the tarball, installs it the way the
  README says, and **imports every subpath**, because each of these threw at import rather
  than at install.

## 0.1.0

### Minor Changes

- [#25](https://github.com/taslabs-net/homeflare-kit/pull/25) [`309c644`](https://github.com/taslabs-net/homeflare-kit/commit/309c644d83c7149571f4caada135d1b8d141a484) Thanks [@taslabs-net](https://github.com/taslabs-net)! - New package: custom Alchemy providers for five systems the vendor has none for.

  **`R2BucketLock`** — an R2 bucket's lock rules, declared rather than applied by hand. A
  lock rule is a retention floor: while a rule covers an object, no API call, no lifecycle
  rule and no credential can delete it.

  ★ Alchemy 2.0.0-beta.77 has no lock property anywhere in its R2 namespace, so the
  alternative was a runbook step a human runs once — and a plan can never show a missing
  runbook step. Covering the gap with a resource makes the drift visible in `plan`.

  ⛔ Deletion is refused by design: removing a lock removes a retention floor, which is the
  one operation this resource exists to make hard.

  ⚠️ `alchemy`, `cloudflare` and `effect` are **peers**, not dependencies — Alchemy's
  resource registry and Effect's context both break if two copies load in one process.

  **Also in this release** — the same treatment for four more systems, 140 files in all:

  - **`/proxmox`** (61 source files) — ACLs, API tokens, backup jobs, Ceph, SDN, storage.
  - **`/openbao`** (33) — mounts, policies, PKI/SSH/auth roles, Cloudflare role expansion.
  - **`/forgejo`** (12) — branch protection, org secrets, labels, webhooks.
  - **`/talos`** (8) — cluster bootstrap, machine config, health.

  ⛔ **Import a subpath, never the root.** Each system carries its own client, so a root
  barrel would pull Proxmox into a stack that only wanted Forgejo.

  ★ **The barrels are deliberately smaller than the directories** — 70 exported symbols out
  of 606 defined, chosen from what a real stack actually consumes. An `export *` would
  publish every helper as API and make the next refactor a breaking change.
