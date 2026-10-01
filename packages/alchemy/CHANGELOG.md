# @homeflare/alchemy

Earlier releases: [changelog archive](./docs/changelog/README.md).

## 0.44.0

### Minor Changes

- [#340](https://github.com/taslabs-net/homeflare-kit/pull/340) [`6074be6`](https://github.com/taslabs-net/homeflare-kit/commit/6074be64e98624debfececcdae5c30e5048eb3dc) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `LiteLLM.Credential`, one row of LiteLLM's reusable credential table (`/credentials/*`): a named bag of values the proxy stores encrypted and answers masked. Adopted by `credentialName`, the table's unique column, and `defaultRemovalPolicy: 'retain'`, because a deployment's `model_id` may reference the row. The values are write-only: `credentialValues` is `Record<string, { fromEnv: 'NAME' }>` — the name lands in state, the value is resolved from the deploying process's environment and sent once in the create body, never a prop, an attribute, or an error. LiteLLM answers the values masked (`litellm_logging.py::_get_masked_values`, read on 1.103.0), so drift is decided by a salted scrypt seal of the resolved values (`valuesSeal`): an unset variable is "cannot tell" and never drifts a plan-only environment, and a write demands every declared variable, because the update path is a whole-row DELETE + POST. The SDK's typed PATCH operation is wire-broken (its body omits `credential_name`, which the vendor's `UpdateCredentialItem` requires — measured with a stub fetch against the SDK), so the rewrite uses the vendor's own delete and create, and the typed fix belongs in the distilled clone. A sensitive-keyed `credentialInfo` entry is refused at plan time: `credential_info` is stored and returned in the clear. Walked against LiteLLM 1.103.0 through `@distilled.cloud/litellm`'s `credential_management` operations (`GET /credentials/by_name/{name}`, `POST /credentials`, `DELETE /credentials/{name}`).

- [#331](https://github.com/taslabs-net/homeflare-kit/pull/331) [`de03144`](https://github.com/taslabs-net/homeflare-kit/commit/de03144d46fa766afe64e471aaa75a64f0f06d8c) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `LiteLLM.Key`, a LiteLLM virtual key that binds to a `LiteLLM.Budget` tier. It is found by its alias, so an existing key is adopted without holding its value, and it defaults to `retain` on removal. The key value is write-only: `key: { fromEnv: 'NAME' }` names the environment variable, the value goes to `/key/generate` once and is never a prop, an attribute, or in an error: a create that fails on the wire is a `LitellmKeyTransportError`, which keeps neither the request nor its cause, because the SDK's `HttpClientError` holds the request body. It refuses a create while `DISTILLED_DEBUG_HTTP` is set, because the SDK would print the key. Walked against LiteLLM 1.103.0 through `@distilled.cloud/litellm`'s `key_management` operations (`/key/list`, `/key/generate`, `/key/update`, `/key/delete`).

  A declaration manages only what it names: an omitted `budgetId`, `models`, `allowedRoutes`, `teamId` or `duration` is neither compared nor sent, so a live scope, budget, team or expiry stays (omission used to clear it, which widened an adopted key: `[]` is "all models"). Clearing is explicit: `models: []`, `allowedRoutes: []`, `budgetId: null`, `teamId: null`, `duration: null`. `metadata` is a merge: the declared keys are compared and written, every other live key (guardrails, per-model limits, passthrough routes) is carried into the update, and a key is cleared by declaring it `null`. The callback slots `logging`, `callback_settings` and `secret_manager_settings` carry secret keys, so they are never put in state (only their names, as `withheld`), a declaration naming one is refused (`LitellmKeyCallbackMetadataDeclaredError`), and a metadata write onto a key that has one is refused (`LitellmKeyCallbackMetadataLiveError`).

- [#330](https://github.com/taslabs-net/homeflare-kit/pull/330) [`21f41c9`](https://github.com/taslabs-net/homeflare-kit/commit/21f41c9c680642d8f68e34f224f5fa70b7a00ca9) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `LiteLLM.MCPServer` (`@homeflare/alchemy/litellm`), one row of LiteLLM's MCP server table, on `@distilled.cloud/litellm`'s `mcp_management` operations (generated from LiteLLM v1.103.0, not measured against a live proxy). It adopts an existing row by `serverName` (or pins one by `serverId`), defaults to `retain`, and always compares the key and group grants (`allowAllKeys` defaults to `false`, `mcpAccessGroups`). `allowedTools` is compared and sent only when declared, because an empty list turns LiteLLM's tool whitelist off (read from the 1.103.0 source), so adopting a whitelisted row never widens it. A static credential is declared as `authValue: { fromEnv: 'NAME' }`, never a value, and a rotated credential is noticed through a salted seal; reading a server copies no credential, header or environment value, and a URL is redacted on the way in. It refuses `stdio`, a URL that carries a secret, and a static auth type without a credential, demands the credential on any write that changes the auth type (LiteLLM wipes the stored one otherwise), and reads back every write so a field the proxy did not apply fails the deploy. LiteLLM's list route is its in-memory registry, not the table, so a row missing from it is read by id from the table, a delete always sends its DELETE, and a create whose registry refresh failed is recorded rather than retried. An update never lets LiteLLM default the alias to the server name (it would rename every tool), and a `description` that the row's `mcp_info` would hide is refused before any write.

- [#335](https://github.com/taslabs-net/homeflare-kit/pull/335) [`d9b0b7b`](https://github.com/taslabs-net/homeflare-kit/commit/d9b0b7bb017a7c236644e0e4d875fa685108c247) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `LiteLLM.Model` (`@homeflare/alchemy/litellm`), one deployment row of LiteLLM's model registry (`/model/*`), on `@distilled.cloud/litellm`'s `model_management` operations (generated from LiteLLM v1.103.0, not measured against a live proxy). It adopts an existing row by `modelName` (a name matching several listed rows is refused) or pins one by `id`, and defaults `retain` because removing a deployment takes it out of its routing group for every key that reaches it. `model` must carry a provider prefix (`xai/grok-4.7`, `cloudflare/@cf/...`) and must not use `openai/` on a grok group — Grok is xAI. The upstream credential is `apiKey: { fromEnv: 'NAME' }` only, sent in LiteLLM's own `os.environ/NAME` reference form so the proxy resolves it in its own environment; a literal value is refused because props land in Alchemy's unencrypted state, and an adopted row's `apiKey` omitted is a leave-alone, never a blank. LiteLLM stores `litellm_params` encrypted, so reads compare only the fields the row returns and a `paramsSeal` digest of the DECLARED values, never the ciphertext. Every write is read back, so a field the proxy did not apply fails the deploy. `litellm_params` and a rename go to `POST /model/update` (`model_name` only when it changed, because a same-name body would collide with a sibling deployment in the group). `access_groups`, `mode` and `base_model` go to `PATCH /model/{id}/update`, the route whose merge writes `model_info`. A missing id on `GET /model/info` is HTTP 400 at v1.100.0 and v1.103.0, so absence is a re-list that lacks the id, never the error text. A changed `modelName` without a pinned `id` is a new group with the old row retained under `retain`; a changed `id` is a replace. Delete is idempotent by this resource: a `BadRequest` re-lists, and only a genuinely-absent id counts as already deleted. Whether `/model/new` honours a supplied `model_info.id` is unmeasured at v1.103.0, so the id asked for is the one tracked and a read-back that cannot find it fails the deploy.

- [#337](https://github.com/taslabs-net/homeflare-kit/pull/337) [`c76dca9`](https://github.com/taslabs-net/homeflare-kit/commit/c76dca9043bab95fe6ff1dd2affeeb3c83e6300e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add six LiteLLM registry resources to `@homeflare/alchemy/litellm`, each on `@distilled.cloud/litellm` 0.3.0's typed operations (generated from LiteLLM v1.103.0; the source behind every rule was read from a 1.103.0 container, and no live proxy was called). `LiteLLM.Team` manages a team's models, MCP grants (`object_permission`, a merge by field, so an adopted team keeps what is not declared), unified access group ids and an additive member roster; it never removes a member (`/team/member_delete` also deletes that user's keys) and defaults to `retain` (`/team/delete` deletes the team's keys). `LiteLLM.AccessGroup` is a unified access group (models and MCP server ids, adopted by its unique name; team and key edges are declared on the team). `LiteLLM.Toolset` is a named selection of server and tool pairs, read by id from the table because the list swallows database errors. `LiteLLM.Policy` manages a policy's production version through the draft, publish, promote sequence LiteLLM requires and refuses to shadow a config.yaml policy. `LiteLLM.PolicyAttachment` is immutable, so a change is a create-first replace, and an attachment with no selector (which LiteLLM treats as global) is refused. `LiteLLM.ToolPolicy` sets a tool's input and output trust policy and is inert until the proxy's `tool_policy` guardrail is configured. Every resource compares only what it declares, reads back each write, and refuses a blank, padded or repeated entry before any request. The registry refusals are exported as `LitellmRegistry*Error`.

- [#338](https://github.com/taslabs-net/homeflare-kit/pull/338) [`501997d`](https://github.com/taslabs-net/homeflare-kit/commit/501997d9540d1aa7b685dfc4401cdf9ad0d3bb86) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `Postgres.Grants` (`@homeflare/alchemy/postgres`), one declarative grant set for one role in one schema of one database on the runner transport `Postgres.Database` shipped in [#324](https://github.com/taslabs-net/homeflare-kit/issues/324): schema `USAGE`/`CREATE`, per-table privileges, per-column privileges, default privileges for future tables per creator role, and an optional `revokeFromPublic`. Live state is read through `aclexplode` (PUBLIC at grantee oid zero), so a re-run with nothing changed writes nothing and drift on any declared object is repaired — `REVOKE ALL` then `GRANT`, with mixed WITH GRANT OPTION lists split into two statements because one option clause grants the option to every listed privilege. Removing an entry from the declaration revokes it before the new declaration's plan runs (a removal is a drift, never a silent retention), and because the server's table-level `REVOKE ALL` also clears that grantee's column entries on the table (measured on PG 18.6), a revoked table's declared columns are re-granted in the same pass. Objects the declared role OWNS are left alone: the repair and the delete skip them (an owner holds every privilege implicitly, and a `REVOKE` cannot take that away), the ownership facts (`schemaOwnedByRole`, `ownedTables`) are recorded in state, and `read` answers `undefined` for a target that holds nothing. The handlers open the declared database (the family connection stays on the maintenance database) and refuse unless `current_database()` matches; a delete whose database is already gone is a no-op. Every vocabulary is pinned against committed `acl.h`/`grant.sgml` excerpts at `REL_18_6` (`grants-provenance.test.ts`); a word outside the table/schema/column sets, a 63+-byte name, a duplicate object, or a `role`/`database`/`schema` retarget is refused at plan, and a repair that fails to converge (a third grantor's surviving grant) fails loud with the surviving statements instead of re-planning forever. `delete` (retain is the default) revokes exactly what the last declaration named, never re-grants, never cascades, and is a no-op when the role or schema is gone. The per-seat example — a seat group role that writes its own schema in `agents` and selects only from the shared ledger view — lives in `docs/postgres-grants-example.md`.

- [#336](https://github.com/taslabs-net/homeflare-kit/pull/336) [`38f1b6c`](https://github.com/taslabs-net/homeflare-kit/commit/38f1b6c5c7fe0244ce624b87dbc88b12868d2870) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `Postgres.Role` (`@homeflare/alchemy/postgres`), create / adopt / alter / drop of a LOGIN or NOLOGIN role on the same self-hosted PostgreSQL 18.6 cluster `Postgres.Database` talks to, over the socket or runner transport. It adopts an existing role by name (defaults to `retain`; a destroy is a full `DROP ROLE IF EXISTS`, and a role that still owns objects fails with the server's own `2BP01`), and unlike `Postgres.Database` it is alter-capable: `login`, `inherit`, `connectionLimit` and `validUntil` drift is brought back with atomic `ALTER ROLE` statements, while memberships move through one-parent `GRANT`/`REVOKE` (`memberOf` omitted leaves live memberships alone, `[]` ensures none). A rename, a name over 63 UTF-8 bytes (`NAMEDATALEN` 64 — the server would truncate with only a NOTICE), and a zone-free `validUntil` (the session's time zone would never match the deployer's UTC parse, so every plan would re-issue the same `ALTER`) are refused at plan. The password is a reference, never a value: `password: { fromEnv: 'NAME' }`, resolved into a `Redacted` at reconcile time and sent only as the client-side SCRAM-SHA-256 verifier inside the one `ALTER ROLE … PASSWORD` statement, so no statement text, span, server log or error ever holds the plain password; state holds only a salted `scrypt` seal so a rotated environment value is noticed and a matching one is never re-sent. A declared password whose variable is unset refuses before any write, and every write is re-read from `pg_roles`, a vanished create failing typed.

- [#334](https://github.com/taslabs-net/homeflare-kit/pull/334) [`c87df6b`](https://github.com/taslabs-net/homeflare-kit/commit/c87df6b605decbdcfb76ebf196d0e22301edf0dc) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `Postgres.Schema` (`@homeflare/alchemy/postgres`), one schema inside a self-hosted PostgreSQL 18 cluster, on the transport `Postgres.Database` already uses (`postgresProviders` over the wire, `postgresRunnerProviders` over the loopback psql runner). It creates with `CREATE SCHEMA IF NOT EXISTS` (optionally `AUTHORIZATION` an existing role, else the executing role), asserts `owner` and `comment` against the live `pg_namespace` row — a mismatch is a typed `PostgresSchemaDrift` refusal, never an `ALTER SCHEMA`. An omitted `owner` is asserted against `current_user` (the role a fresh create without `AUTHORIZATION` is owned by), and a concurrent creator who wins `IF NOT EXISTS` is that drift refusal before any `COMMENT ON`, so the foreign schema is never commented and never returned. An already-live schema is adopted through `adopt(true)`, because a schema carries no ownership mark (`read` answers `Unowned`). Names over 63 UTF-8 bytes are refused at plan (`NAMEDATALEN` truncation), a renamed logical id is refused at plan, and a create whose immediate re-read still finds nothing fails with `PostgresSchemaCreateVanished`. `delete` keeps `defaultRemovalPolicy: 'retain'`; a `RemovalPolicy.destroy()` delete refuses a non-empty schema unless `cascade: true` is declared, and the `DROP SCHEMA IF EXISTS` is idempotent.

  A required `database` prop pins each schema to one database of the cluster: the handlers open it on the family connection (`withPg`'s database override — `psql -d` on the runner transport, the pool's `database` on the socket transport) and prove it with `current_database()` before any write, so a schema meant for `agents` can never land in the maintenance database a family connection targets. Changing `database` is refused at plan, the same way a rename is. A `cascade` change answers `update` (compared against the persisted previous props), so the flipped value reaches state instead of the engine's noop branch silently keeping the old one. The non-empty refusal checks `pg_class`, `pg_proc`, `pg_type` and `pg_operator` (a schema holding only functions or enums is still refused) and classifies the server's own `2BP01` refusal as the same typed tag (`2BP01` is class `2B`, so both transports wrap it as `UnknownError` with the code on `reason.cause.code` — the classifier reads that code); a declared `comment: ''` is "no comment", never a drift loop against the NULL Postgres stores for it. `read` and `delete` treat a missing declared database as "schema absent" — a `pg_database` probe over the family connection runs before either connects, so a cold cluster surfaces a typed "absent" answer where the runner transport would otherwise fail with `ConnectionError` and the socket transport with a raw `3D000`. `delete` re-reads before any `DROP`: an absent schema is idempotent success, and a live row whose `oid` or `owner` no longer matches the persisted proof fails with `PostgresSchemaDeleteForeignRefused` — no `DROP` is issued, `CASCADE` included, so a schema dropped out of band and recreated by another role survives the delete. A schema whose database does not exist yet is declared as `database: db.name`, an Output referencing the `Postgres.Database` resource: the cold plan skips the live probe and plans a create, and apply orders the `Database` create before the `Schema`. Everything is covered by fake-client tests on the recording `fake-sql.ts` executor, handler tests over a loopback psql runner, and socket-transport tests over a mocked `PgClient` pool; no live database was touched.

- [#339](https://github.com/taslabs-net/homeflare-kit/pull/339) [`950e5b9`](https://github.com/taslabs-net/homeflare-kit/commit/950e5b9642b1c1127dd16fa537e4851baf02460e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `Valkey.Instance` and `Valkey.AclFile` (`@homeflare/alchemy/valkey`): assert-and-read a running Valkey server (`INFO`/`CONFIG GET`, drift refused, delete never stops it) and declare each instance's ACL users with key-prefix scopes and fixed command profiles, passwords by `{ fromEnv }` reference (state stores a scrypt seal, never the value). A seat `keyPrefix` other than `<name>:*` is refused before any write. The socket has a deadline and a reply-length cap; a peer reset returns `ValkeySocketError` instead of exiting the process. Hand-rolled RESP over `node:net`; no `@distilled.cloud/valkey` exists.

  Round-3 hardening: `Valkey.AclFile` supports kit-owned instances without `--aclfile` only.
  Configured ACL files are refused on reconcile/delete, including adoption's forced reconcile;
  CT100's ACLs remain owned by `homeflare-ct100` templates and its users cannot run `ACL LIST`.
  Management is runtime-only and must be reapplied after restart. Ordinary plan diff compares
  stored attributes; `alchemy drift` re-reads live state.

  Keep connections available to lifecycle handlers with `Layer.provideMerge` and route each
  resource through its named instance connection (`valkeyProviders` now requires `instance`).
  Missing names fail with `ValkeyConnectionMissing`; combined providers cannot redirect seat
  users to a different named instance. Track managed usernames separately from observed users:
  removing a declared seat plans an update and revokes it, while never-managed users survive
  unless `exclusive: true`. Map ACL socket acquisition and operation failures to the typed
  `ValkeyInstanceUnreachable`; authentication failures retain their own typed errors.

  Also add ct100#117's key-less monitor profile, scope service channels, and send SHA-256
  password tokens. The bounded RESP implementation's exception to beta.79 Redis reuse is
  source-audited and tested. Valkey 8.1.10/9.1.1 remain the vendor versions walked against;
  no live estate instance was accessed.

### Patch Changes

- [#347](https://github.com/taslabs-net/homeflare-kit/pull/347) [`9ac49b5`](https://github.com/taslabs-net/homeflare-kit/commit/9ac49b5e54b3c287c2fcf59378eeef0d4f878778) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Harden `LiteLLM.Key` and `LiteLLM.Credential` against the review findings on their release PRs.

  `LiteLLM.Credential`: a create onto a name another owner already holds is refused at apply, never overwritten (`refuseTakeover`, matching `LiteLLM.Key`); a `POST /credentials` that fails on the wire is a `LitellmCredentialTransportError` that keeps neither the request nor its cause (the body holds the values), and a create is refused while `DISTILLED_DEBUG_HTTP` is set (the SDK would print the values); the by-name read and delete `catchTag` the SDK's `CredentialNotFound` instead of `instanceof NotFound`, so a 404 from a front proxy or wrong base path stays an error rather than reading as absence. A changed row is now updated with `PATCH /credentials/{name}` (a value-key merge with full intended info) instead of a whole-row DELETE + POST, so a write that fails on the wire leaves the row in place — the DELETE + POST rewrite left no row when the POST failed after the DELETE. Removing value keys or in-memory info keys requires a whole-row rewrite. Reconcile refuses debug logging and missing required values before DELETE. Info is the complete intended map, including on adoption, so undeclared live info keys are deliberately removed. PATCH normally replaces DB info but only merges memory info; it sends the full intended map.

  `LiteLLM.Key`: an owned or adopted key whose declared `key: { fromEnv }` value is not the key the live row holds is refused (`LitellmKeyValueMismatchError`), compared only as a sha256 in memory against the row's `token` (`hash_token`) — never persisted, never in an error. `/key/update` cannot change a key's value, so a mismatch is nothing to write: fix the variable or rotate with a new alias. Alchemy beta.79 calls the effectful diff even for unchanged props, so an environment-only rotation is refused during plan. Unset/empty variables skip verification for an existing key, allowing settings updates without the seat key; creates still require the value.

  `@homeflare/distilled-litellm`: the by-name read and delete now type their `404` as `CredentialNotFound` (matched on the vendor's `Credential not found`), so `catchTag` sees it; the credential PATCH now carries `credential_name` in its request body (a second member `credential_name_body`, wire-named `credential_name`) so it answers the vendor's `UpdateCredentialItem` instead of a 422.

  Walked against LiteLLM 1.103.0 `proxy/credential_endpoints/endpoints.py:312–319,384–387` and Alchemy 2.0.0-beta.79 `src/Provider.ts:274–289`, `src/Plan.ts:1503–1527`. Regression tests exercise real Plan/Apply and SDK encoding; the fake models separate DB/memory semantics, records PATCH bodies, requires the body name (422), and uses the vendor 404 error envelope.

  An owned key deleted outside the stack now plans an update and is recreated using its declared variable; only a live row is checked for a value mismatch. A credential rewrite whose POST fails after DELETE reports `LitellmCredentialRewriteError`, explicitly identifies the completed DELETE, and explains that the next deploy recreates an absent row. Regression tests cover dashboard deletion with a models change, live mismatches, and failed rewrite recovery through real Plan/Apply.

- [#333](https://github.com/taslabs-net/homeflare-kit/pull/333) [`dee271f`](https://github.com/taslabs-net/homeflare-kit/commit/dee271f5d4e13fa0624150c4310716bd01b97646) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `LiteLLM.MCPServer` refuses, at plan time, a `serverName` or `alias` outside `^[A-Za-z0-9._]{1,128}$` and a declared blank `description`. LiteLLM 1.103 rejects those names only when applying (`validate_tool_name`), and a blank description is written but never copied into `mcp_info`, so the row would never converge. A changed `serverName` keeps the live tool prefix; declare `alias` to change it. `LitellmMcpServerDescriptionShadowedError` is exported from `@homeflare/alchemy/litellm`.

- [#345](https://github.com/taslabs-net/homeflare-kit/pull/345) [`d5bfcee`](https://github.com/taslabs-net/homeflare-kit/commit/d5bfcee497eeea8f348c14d673d73042ba895f2f) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fix the review-seat findings on `Postgres.Grants` and `LiteLLM.Model` ahead of the `@homeflare/alchemy` release:

  - `Postgres.Grants` `read` now records whether the revoker can act as the object's owner (`pg_has_role(current_user, relowner, 'USAGE')`), so a grant made by the object's owner counts as restorable when the revoker is the owner, a superuser, or a member of the owning role — and is dropped otherwise, instead of the revoker's superuser status alone deciding.
  - `Postgres.Grants` `delete` re-grants collateral the table's revoke would otherwise clear, matching the "never re-grants" doctrine (the earlier wording claimed the opposite; the revoke plan restores the collateral it removes).
  - `Postgres.Grants` `reconcile` into a dropped database fails with the typed `PostgresGrantsDatabaseMissing` instead of an untyped connect failure.
  - `LiteLLM.Model` now exports `LitellmModelForeignRowError` and `LitellmModelConfigFileRowError` from `@homeflare/alchemy/litellm` (they were raised but not on the barrel).

- [#335](https://github.com/taslabs-net/homeflare-kit/pull/335) [`d9b0b7b`](https://github.com/taslabs-net/homeflare-kit/commit/d9b0b7bb017a7c236644e0e4d875fa685108c247) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Pin `redis` to `6.3.0` in the documented `overrides` block, exact against the same class of
  upstream gap measured on 2026-09-30: `redis@6.3.0` reached npm at 11:03Z minutes before its
  own exact dependency `@redis/time-series@6.3.0` (published 11:12:19Z), so a lockfile-less
  consumer install floating the `>=5.0.0 <7.0.0` peer of `@effect/platform-node`/`@effect/sql-pg`
  to the dist-tag latest failed outright for that window. The pin sits on the now-complete 6.3.0
  line and stays exact because the gap can recur with any future redis minor.

- [#343](https://github.com/taslabs-net/homeflare-kit/pull/343) [`aed1eff`](https://github.com/taslabs-net/homeflare-kit/commit/aed1efff2b9ad8125b5be3a057864bfa29216429) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fix Postgres.Schema takeover and identity checks, walked against PostgreSQL 18.6
  (REL_18_6). Existing schemas without persisted output and duplicate-create races now
  require explicit adoption, including crash recovery. Refuse recycled oids and repeat
  name/database change refusals during apply when unresolved Outputs skipped planning.

  Escape SQL string literals safely under either standard_conforming_strings setting,
  including Schema comments, Database options, Role literals and psql-bound parameters.
  Preserve Role password redaction for escape literals. Correct the schema fake's
  PostgreSQL semantics and isolate socket tests with an Effect-scoped pool factory.

- [#344](https://github.com/taslabs-net/homeflare-kit/pull/344) [`c86c1a3`](https://github.com/taslabs-net/homeflare-kit/commit/c86c1a34b4ed8973c2736b1b2d84dffdae30790f) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Valkey.AclFile delete removes only the users the declaration managed.

## 0.43.0

### Minor Changes

- [#322](https://github.com/taslabs-net/homeflare-kit/pull/322) [`efaecde`](https://github.com/taslabs-net/homeflare-kit/commit/efaecde10af13de3087cc3f78aafa098c9147c3b) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Bao.AuthRole` now supports an optional `tokenPeriod` duration prop, written as the modern OpenBao `token_period` field. Omitting it leaves any existing live value unmanaged.

- [#323](https://github.com/taslabs-net/homeflare-kit/pull/323) [`1e230b1`](https://github.com/taslabs-net/homeflare-kit/commit/1e230b138081b58a758fb5b1805f8ce1c05f3c1a) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `LiteLLM.Budget`, the first LiteLLM resource beyond pass-through endpoints. It declares a budget tier with `softBudget` as the monitoring field, never defaults `max_budget`, and refuses a hard `maxBudget` without a `maxBudgetReason`. It adopts existing tier rows by id and defaults to `retain` on removal.

- [#324](https://github.com/taslabs-net/homeflare-kit/pull/324) [`48b809a`](https://github.com/taslabs-net/homeflare-kit/commit/48b809afbc95ef5ab79014bc28f73d856a20e957) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Postgres.Database` can now reach a loopback-only cluster through a caller-supplied command runner (`postgresRunnerProviders`), creating databases `FROM template0` by default on that transport.

### Patch Changes

- [#319](https://github.com/taslabs-net/homeflare-kit/pull/319) [`1a7b3d2`](https://github.com/taslabs-net/homeflare-kit/commit/1a7b3d262046e93bf473509cd9865e3522bb92f8) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Proxmox.CephFlag` now calls the typed cluster flag operations. A GET that is not a bare boolean fails the plan instead of reading the flag as clear, and a refused read reports noop instead of aborting every other row.

## 0.42.0

### Minor Changes

- [#315](https://github.com/taslabs-net/homeflare-kit/pull/315) [`3f06204`](https://github.com/taslabs-net/homeflare-kit/commit/3f062045e54190a94d89c54bd3c1b442faf489ae) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `PveTarget` gains an optional `roles` field (`{ read?: string; provision?: string }`) that
  overrides which OpenBao mint TIER NAME a semantic `PveRole` resolves to — `mintTier`
  (`proxmox/credentials.ts`) is the one place that resolution happens, and it is now the single
  composer of `<mount>/creds/<tier>` across the package: `mint.ts`'s HTTP call, its error paths
  (`PveCredentialDenied` now carries the resolved `tier` in place of the semantic `role` it used to
  carry, so a 403 message names the tier actually requested — the bare role is no longer
  reconstructible once an override applies, so it was dropped rather than left stale), and
  `lease-cache.ts`'s cache key (a resolved-tier lease key was required too — without it, two
  consumers sharing a mount/role but different overrides would collide into one cache entry and
  hand each other's credential to the wrong caller; see `lease-cache.ts`'s own header).

  Omitted `roles`, or a role it doesn't name: unchanged — `role` is also the tier name, exactly as
  every consumer before this field got. homeflare-proxmox's Talos lane is the first consumer,
  scoping its reads through the `talos-provision` tier instead of the estate's general `read`
  (board decision 69's talos-deploy lane).

## 0.41.0

### Minor Changes

- [#313](https://github.com/taslabs-net/homeflare-kit/pull/313) [`f167fd2`](https://github.com/taslabs-net/homeflare-kit/commit/f167fd2a3e152462dc9da579ca92263aa695a558) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Host.Directory's chmod/chown no longer decide whether to pass `--` by the OS of the machine running Alchemy. They now read the target's own platform from `HostRunner.platform` — a new field every `HostRunner` declares (`localRunner()`, `sshRunner()`, `sshSudoRunner()`, and any consumer's own runner).

  Deploying from a Mac to a Linux host over `sshSudoRunner` (homeflare-ct100, 2026-09-27) dropped GNU's required `--` because the old check read `process.platform`, the Mac's own OS, and the sudo allowlist refused every chown with `SudoRefusedError` even though the path was under a declared prefix. `localRunner()`'s own local deploys never showed this, because there the target and the calling process are the same machine.

  A custom `HostRunner` implementation now needs to declare `platform: 'darwin' | 'linux'`.

### Patch Changes

- [#264](https://github.com/taslabs-net/homeflare-kit/pull/264) [`a2a4818`](https://github.com/taslabs-net/homeflare-kit/commit/a2a4818226d2c672c3a96132231f8ff09ae2cbf4) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Compatibility fix for the already-merged `opnsense/*` family (PR [#236](https://github.com/taslabs-net/homeflare-kit/issues/236)),
  made necessary by this PR's `@homeflare/distilled-opnsense` SDK bump: the
  whole-model `get()` this family's `Opnsense.Firewall.Alias`/`Opnsense.Firewall.Group`
  `fetchLive` reads now correctly decodes list-shaped fields (`type`,
  `interface`, `proto`, `categories`, `members`, `content`) as OPNsense's
  real option-map shape `{key: {value, selected}}`, not a string — see the
  SDK PR's OPNSENSE-2 fix.

  This surfaces (and fixes) a real, previously-masked bug rather than
  introducing one: `alias-form.ts`'s old `csvSet(live.categories)` called
  `.trim()` on what the pre-fix SDK typed as a string — the exact crash
  class the SDK PR's changeset describes for the live homeflare-network
  import — just never hit here because this family's own tests used a fake
  OPNsense returning string-shaped fixtures that matched the bug instead of
  the real wire. `wire.ts`'s new `selectedOf`/`selectedOneOf` extract the
  selected key(s) back to the plain string/string[] shape
  `AliasAttributes`/`GroupAttributes` already declared, so `matches` and the
  declaration renderer (`propsFromLive`) are behaviorally unchanged for any
  already-correct declaration.

  No live-plan impact expected: this is the read path decoding correctly
  for the first time against a real option-map response, not a change to
  what a declaration renders or what `matches` reports for a value that was
  already being read successfully (a value that decoded as `[object Object]`
  or threw before this fix could never have matched a real declaration
  anyway).

  **Still held for the follow-up PR** (per the SDK PR's own note): switching
  `Category`/`Group` to their now-correct per-item `getCategory`/`getGroup`
  (OPNSENSE-1) instead of whole-model `get()`, `catchTag` typed errors, a
  delete-of-absent test and a transient-read-propagates test.

  **The opnsense family is correct for consumers only after the alias pin
  moves to the released `distilled-opnsense`.** `packages/alchemy/
package.json` still pins `"@distilled.cloud/opnsense": "npm:@homeflare/
distilled-opnsense@0.2.0"` exactly — this PR does not bump it. The bun
  workspace links the local package during development, which is why this
  fix's tests and this repo's own pre-push gate pass, but a published
  `@homeflare/alchemy` consumer installs the pinned `0.2.0` from npm, which
  still cannot decode option maps, underneath family code that now expects
  them. Moving the pin is a separate, later PR, once `@homeflare/
distilled-opnsense` has actually released (the same two-step precedent as
  kit commit `06591c9` / PR [#206](https://github.com/taslabs-net/homeflare-kit/issues/206)).

- [#314](https://github.com/taslabs-net/homeflare-kit/pull/314) [`3e9d6f3`](https://github.com/taslabs-net/homeflare-kit/commit/3e9d6f339938e0ead794b98598344c77033fe59e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fix `Proxmox.Storage` updates: `reconcile` used to PUT the FULL declared
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

  Second pass (same day, a red team on this PR before merge): a declared
  `shared` on a type outside `sharedAccepted` that genuinely disagrees
  with what PVE reports used to vanish into the same skip and plan `noop`
  forever, silently — the recorded attribute stayed whatever PVE already
  had, with no warning. `matches` now dies with a clear message on exactly
  that one case; a matching or undeclared `shared` is unaffected and still
  plans `noop`. Also, `btrfs` and `esxi` were re-checked against
  `github.com/proxmox/pve-storage` (master, 2026-09-27) and do accept
  `shared` in their own `options()` (`BTRFSPlugin.pm:69`,
  `ESXiPlugin.pm:52`) — moved from unverified into `sharedAccepted`, so a
  declared `shared` on one of those two types is sent again rather than
  silently dropped; `iscsi`, `iscsidirect` and the remote-ZFS `zfs` plugin
  are now verified absent rather than unverified.

## 0.40.0

### Minor Changes

- [#306](https://github.com/taslabs-net/homeflare-kit/pull/306) [`d11352c`](https://github.com/taslabs-net/homeflare-kit/commit/d11352c29cb39ea9f1abba5464662b26ee9c4e1b) Thanks [@taslabs-net](https://github.com/taslabs-net)! - New `@homeflare/alchemy/ceph`: `Ceph.AuthEntity` (K-A4), plus the ssh mon-command transport it
  runs on — built for the Talos-on-PVE ceph-csi entity, per the accepted design
  (`docs/plans/2026-09-26-ceph-mon-transport.md`).

  The PVE API has no `ceph auth` endpoint at all (measured against the pinned schema); this family
  closes that gap over ssh + `sudo -n /usr/bin/ceph`, tried against the declared mon nodes in order,
  behind a client-side argv allowlist of exact shapes — `auth get`, `auth get-or-create`, `auth
caps`, and `config get`/`set`/`rm` against a named option list that starts empty. `auth ls` and
  `auth del` are refused outright: `ls` prints every key on the cluster, and a wrong delete cuts
  every VM disk on it (D3, lockout safety — never auto-delete). The entity operand is bounded to the
  `client.k8s-` prefix, so nothing this allowlist accepts can touch `client.admin`, a mon/osd/mgr
  keyring, or the PVE storage client.

  The minted key is captured in memory only, never Alchemy props, state, argv, or a log line.
  `auth get-or-create` mints it once, on the create path, and writes it straight to OpenBao
  (`<mount>/ceph/<entity>`). `auth get`'s stdout, which also carries the key, is read unfiltered on
  every reconcile to compare caps — the key is parsed out and dropped before anything is logged,
  returned or stored, so it never survives past that one read. Caps drift runs `auth caps` alone and
  never re-mints the key. After every write the transport re-checks
  `quorum_status` on a fresh connection and fails the row on a degraded answer, rather than
  continuing past it. `read` and `diff` never ssh — this family's plan is props-against-state only,
  and reconcile is where the only live check happens. Rows are creates through the first-create
  gate: a live entity found with no prior state is refused, not adopted, even under `--adopt`.

  Tested entirely offline against a fake dial — no ssh, no spawned process, ever, in this package's
  own test suite. `Ceph.AuthEntity` itself is not yet consumed by a stack; that lands with the
  Talos-on-PVE work this design gates.

- [#311](https://github.com/taslabs-net/homeflare-kit/pull/311) [`0047c69`](https://github.com/taslabs-net/homeflare-kit/commit/0047c693f0a7259f52492ca1e545adb9c3ae5bad) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Closes the three `Talos.*` follow-ups PR 307 named but did not fix
  (docs/plans/2026-09-26-talos-stack-first-boot.md), and exports their Resource constructors now
  that the fixes land:

  `Talos.Bootstrap` — "once means once". The shipped `isBootstrapped` turned every read failure into
  `false` (`Effect.orElseSucceed`), so `reconcile` could re-run `talosctl bootstrap` against an
  already-bootstrapped cluster after a merely transient read failure — Talos's only server-side guard
  is a non-empty etcd data directory, so this forms a second, isolated single-member cluster (split
  brain) rather than rejoining the existing one. Fixed: `read` now answers presence/absence correctly
  (`undefined` only from a successful read that finds no members; a failing read propagates instead of
  being read as absence); `diff` trusts `output.bootstrapped` once it is `true` and never touches the
  live cluster; `reconcile` checks `output?.bootstrapped` first and, once true, never spawns `talosctl
bootstrap` again — a failing or empty confirmation read both raise the new `TalosReBootstrapRefused`
  instead. Re-bootstrap is now a human decision, never an automatic one.

  `Talos.ClusterHealth` — no more swallowed transport errors. The shipped `read` caught EVERY error
  from its health check, including a `mintTalosconfig`/`bao` failure, into a plain `healthy: false` —
  a vault outage read exactly like "cluster not healthy yet". `read` and `reconcile` now only catch
  `TalosError` (a completed `talosctl health` run that itself exited non-zero); anything else
  propagates. The type's own doc comments also now say explicitly that a consuming stack's `after`
  must reach past `Talos.Bootstrap`/`Talos.Kubeconfig` through the Cilium CNI install — the default
  health checks (kube-proxy, CoreDNS) wait on a CNI that does not exist yet at bootstrap.

  `Talos.Kubeconfig` — lands in OpenBao instead of an un-vaulted host `runtimePath` that was never
  cleaned up. CREATE now runs `talosctl kubeconfig` into a throwaway unguessable temp path, reads it
  back, and writes its bytes into the vault via stdin (`credentials-write.ts`'s new `writeKvValue` —
  never argv), then deletes the temp file. Written ONCE at bring-up, not re-minted every deploy (a
  fresh admin cert every reconcile would rotate credentials for no reason): once `output` is defined,
  reconcile only reads the vault copy back to confirm it. The `runtimePath` prop is gone, replaced by
  an optional `kubeconfigKey` (default `'kubeconfig'`); the persisted `connection` no longer carries a
  host path — a consumer materializes its own temp file via the new `mintKubeconfig` (the same pattern
  `mintTalosconfig` already established for the talosconfig itself). Wiring `Kubernetes.ClusterAdapter`
  to call it is separate, later work.

  `TalosBootstrap`, `TalosClusterHealth` and `TalosKubeconfig` (plus their `*Attributes`/`*Props` types)
  now export from the package barrel alongside their `*Provider` factories, so a consuming stack can
  actually declare these rows — PR 307's red team held them back specifically for the defects above.

  Docs: `docs/plans/2026-09-26-talos-secrets-flow.md` records Tim's D1/D2/D3 answers (decision 61 —
  mini's vault + copy-list entry, agent plan lane denied, O-A all-in-vault-digest-pinned confirmed) and
  `docs/plans/2026-09-26-ceph-mon-transport.md` records decision 65's `auth get` amendment (read
  directly, in-process, on every reconcile — no node-side shell filter for that call — key dropped
  before anything is logged/returned/stored).

  **LAND red team fixes, applied before merge (same PR, never shipped broken):**

  - `Talos.Kubeconfig` could never actually be created — `read` returned a defined, empty-fingerprint
    object instead of `undefined` on a genuine cold start, so the engine always adopted it and forced
    `update`, and `reconcile`'s write-once gate then tried to confirm a key that had never been
    written. Fixed: `read` now distinguishes a measured OpenBao "key never written" response from
    every other failure; `reconcile`'s write-once branch also gates on a non-empty
    `credentialGeneration`, not just a defined `output`.
  - `credentials-write.ts`'s `writeKvValue` used `field=@-`, which is not the stdin convention (`@`
    means "read a file at this literal path") — measured against OpenBao v2.6.2, it fails outright, or
    silently reads a stray file literally named `-`. Fixed to `field=-`.
  - `Talos.ClusterHealth` could never pass with more than one control-plane node — `--nodes` took the
    full node list, and `talosctl health` refuses more than one. Fixed: one contact node for
    `--nodes`/`--endpoints`; the full lists still reach `--control-plane-nodes`/`--worker-nodes`.
  - The persisted `connection`'s `auth.path` was left `undefined`, which would let a consumer's stock
    `Kubernetes.KubeConfigAdapter` silently fall back to `$KUBECONFIG`/`~/.kube/config` instead of
    failing — exactly the exposure this feature removes elsewhere. Fixed to a sentinel path that can
    never resolve, so an early consumer fails loudly instead of reaching a stranger's cluster.
  - `Talos.Bootstrap` gained an optional `peers` prop: before a CREATE bootstraps a node, every listed
    peer must show a successful, empty etcd-members read, closing a split-brain path where a lost
    state row plus a reset node would otherwise re-bootstrap a second cluster.

- [#307](https://github.com/taslabs-net/homeflare-kit/pull/307) [`cf17df3`](https://github.com/taslabs-net/homeflare-kit/commit/cf17df313c12357de18fc937ede093708dd15963) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Talos machine config, talosconfig and any future KV-backed Talos material now come from OpenBao
  instead of repo disk — the accepted secrets-flow design
  (docs/plans/2026-09-26-talos-secrets-flow.md and -talos-stack-first-boot.md).

  Fixed the C1 temp-file-lifetime defect: `mintTalosconfig` used to wrap its own body in
  `Effect.scoped`, so its delete finalizer ran — deleting the file — the instant `mintTalosconfig`
  returned, before any caller ever passed the path to `talosctl`. It is now built on
  `Effect.acquireRelease` and contributes `Scope.Scope` to its own return type, so the file survives
  until the CALLER's own `Effect.scoped` closes; every Talos resource file (`kubeconfig.ts`,
  `talos-bootstrap.ts`, `talos-cluster-health.ts`, `talos-machine-config.ts`) now wraps its
  `read`/`reconcile` bodies accordingly. Also fixed `talosconfigKey`'s default, which read
  `<mount>/data/data/talosconfig` (now `<mount>/talosconfig`) — `bao kv get` inserts the KV-v2
  `data/` segment itself.

  `Talos.MachineConfig`'s props changed: `configFile` (a repo-relative path) and `insecure` are gone.
  Props now carry `configKey` (an OpenBao KV path under `target.mount`, e.g. `nodes/10001`) and a
  required `configDigest` — sha256 of the canonical config text, pinned in git by the operator after
  seeding the KV value. The digest is verified against the live KV content before ANY talosctl spawn;
  a mismatch fails closed with a typed `TalosConfigDigestMismatch`, applying nothing. `insecure` is no
  longer a prop: the CREATE path (`output === undefined`) applies `--insecure` and UPDATE never does,
  since a fixed value broke in both directions. No code path ever builds `--dry-run` (it prints the
  cluster CA key and bootstrap token on an otherwise-empty node).

  The live convergence check now hashes only the `spec` payload extracted from
  `talosctl get machineconfig v1alpha1 -o yaml`'s wrapper (`values.ts`'s new `extractMachineConfigSpec`)
  instead of the whole wrapper, which carries a version/timestamp that changes on every observation and
  could never match the pinned digest. The resource id is never omitted: an unfiltered `get
machineconfig` also lists a `persistent` resource sorted ahead of `v1alpha1`, so a bare `doc[0]` (the
  shipped shape) silently read the wrong one — `extractMachineConfigSpec` now also refuses more than one
  document rather than guessing. `MachineConfigAttributes.converged` is `'read-back' | 'accepted' |
false` instead of a boolean: `reconcile` proves convergence with a bounded, short-interval poll
  (`machine-config-poll.ts`) — `'read-back'` for `no-reboot` (the API never drops), `'accepted'` for
  `reboot`/`auto` (tolerates the API dropping for a reboot) — and raises a typed
  `TalosConvergenceTimeout` rather than a silent pass if the cap expires. `ApplyMode` drops `'staged'`
  and `'try'`: `try` reverts itself after its own timeout, so a poll "confirming" it would be watching a
  change already undone, and `staged` defers to a reboot this package never drives — both need design
  work this change does not do, not a policy guess.

  `read` now answers three ways instead of two (`machine-config-read.ts`), because Alchemy calls it with
  no prior state both as its cold-start adoption probe and to recover an interrupted create: an
  authenticated read that fails but an inserted `--insecure` maintenance-mode probe succeeds means "not
  created yet" (`undefined`); an authenticated read that succeeds and matches the pin is ours (plain
  attributes); one that succeeds and differs is `Unowned` — exists, not proven ours — so the engine
  fails closed behind `--adopt` instead of silently running `apply-config` onto a mistyped or foreign
  node; both reads failing propagates the authenticated error, never a disguised "not created". A
  transport failure was always meant to propagate rather than read as `converged: false` — this was the
  gap that broke it for the cold-start case specifically.

  `TalosMachineConfig` and its `*Provider` now export from the package barrel, so a consuming stack can
  declare `Talos.MachineConfig` rows — it fails closed on a digest mismatch and never adopts silently.
  `Talos.Bootstrap`, `Talos.ClusterHealth` and `Talos.Kubeconfig` stay provider-only: exporting their
  Resource constructors would let a stack declare them, and that is not safe yet — Bootstrap can plan a
  second `talosctl bootstrap` after a failing plan-time read (etcd split-brain risk), and Kubeconfig
  still writes a cluster-admin kubeconfig to un-vaulted host disk. `TalosTarget`/`TalosCredential`/
  `ApplyMode` export unconditionally since they carry no such risk.

  Not in this change, flagged rather than fixed: `Talos.Kubeconfig`'s host-disk kubeconfig (above);
  `Talos.Bootstrap`'s re-bootstrap risk and `Talos.ClusterHealth`'s CNI-ordering swallow-on-failure
  (docs/plans/2026-09-26-talos-stack-first-boot.md's "Bootstrap" and "CNI ordering" sections); no kit
  command yet prints only a KV value's digest, so an operator computes `sha256(canonicalText(content))`
  by hand to pin it.

- [#303](https://github.com/taslabs-net/homeflare-kit/pull/303) [`ca3f3bb`](https://github.com/taslabs-net/homeflare-kit/commit/ca3f3bbfe6659f1e265f2924dd33de8c124ac62c) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Added three more read-only `Unifi.*` families, mirroring `Unifi.Network`/`Unifi.FirewallZone`'s existing shape: `Unifi.DnsPolicy`, `Unifi.AclRule`, and `Unifi.AclRuleOrdering` (one ordered, order-preserving resource per site — never `sortedSet` — for the site's ACL rule priority list, kept separate from `Unifi.AclRule` itself). Each is gated on a per-tag OpenAPI closure diff (10.4.57 vs a 10.6.97 mirror, diffing aid only) confirming its tag decodes the same on both versions; full breakdown in `docs/unifi-dns-policy.md` and `docs/unifi-acl-rule.md`. No write path exists for either family — `reconcile`/`delete` refuse via the existing typed `UnifiWriteRefused`, and the existing `GetOnlyHttpClient` wire guard and static write-op-reference test cover them without any change to either mechanism.

- [#309](https://github.com/taslabs-net/homeflare-kit/pull/309) [`1b24ce7`](https://github.com/taslabs-net/homeflare-kit/commit/1b24ce7d92dc0c3a92ad83f1cf43a44c70e2b59c) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Added three more read-only `Unifi.*` families: `Unifi.FirewallPolicy`, `Unifi.FirewallPolicyOrdering`, and `Unifi.TrafficMatchingList`. `Unifi.FirewallPolicyOrdering` is keyed per `(sourceFirewallZoneId, destinationFirewallZoneId)` zone pair — one resource per pair, not site-wide like `Unifi.AclRuleOrdering` — comparing its `before`/`afterSystemDefined` policy-id lists independently and order-preservingly (T5; never `sortedSet`, since a policy moving between the two halves is real drift on both fields, not one reorder). `Unifi.FirewallPolicy` compares its post-A3-typed `action`/`source`/`destination`/`ipProtocolScope`/`schedule` fields wholesale, normalizing only the one genuinely top-level set-shaped array (`connectionStateFilter`); its own decode-proof test walks B0b's `pageAll` against this family's page shape (T9's 424-live-policy scale) even though `fetchLive` itself reads by id, same as `Unifi.AclRule`. `Unifi.TrafficMatchingList` is the simplest object shape in the directory (no `metadata` at all) and keeps its post-A3-typed `items` union compared wholesale, same known-gap posture ACL rule's own nested filters already carry (a membership-preserving reorder of object-shaped match entries has no cheap canonical sort key).

  Each family is gated on its own per-tag OpenAPI closure diff (10.4.57 vs the same `beezly/unifi-apis` 10.6.97 mirror every other family doc cites, diffing aid only): `Firewall`'s 13 operations (106-schema closure) and `Traffic Matching Lists`' 5 operations (19-schema closure) are both byte-identical between versions and share zero schemas with the 14 that changed elsewhere in the document — corroborated independently by the A3 changeset's own broader 25-operation/139-schema re-check. Full breakdown in `docs/unifi-firewall-policy.md` and `docs/unifi-traffic-matching-list.md`; `docs/unifi.md`'s own family index and its now-outdated "FirewallPolicy is a bigger, separate PR" note are updated to point at them.

  No write path exists for any of the three — `reconcile`/`delete` refuse via the existing typed `UnifiWriteRefused`, and the existing `GetOnlyHttpClient` wire guard and static write-op-reference test cover them without any change to either mechanism.

- [#308](https://github.com/taslabs-net/homeflare-kit/pull/308) [`9e2ccd9`](https://github.com/taslabs-net/homeflare-kit/commit/9e2ccd9a88c1d57fecb7d94c9a4929d1f9017d2c) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Added a fifth read-only `Unifi.*` family, `Unifi.WifiBroadcast` (one WiFi network/SSID broadcast on a site). Unlike every other family here, its declarable shape is built entirely from the LIST endpoint's overview response (`getWifiBroadcastPage`) — the single-object details call (`getWifiBroadcastDetails`) is never called, because that shape carries the WPA/PPSK passphrase (T23; the spec has no `writeOnly` flag on it), and a static guard now bans any source reference to that call under `src/unifi`. `WifiBroadcastProps`/`WifiBroadcastAttributes` type `securityConfiguration` as the overview's own `{type, presharedKeyNetworkIds}` shape, so no passphrase field is DECLARED for them to carry; because the SDK's wire decode does not strip a key a schema doesn't declare, every nested object this family touches (`network`, `hotspotConfiguration`, `broadcastingDeviceFilter`, and each `presharedKeyNetworkIds` element) is rebuilt field-by-field at runtime too, not just typed narrowly — `wifi-broadcast-secrets.test.ts` proves a stray passphrase-shaped key on the wire never survives into attributes, the declaration renderer, or a forced decode-failure error, for all five of those locations. With no get-by-id call for the overview shape, `fetchLive` is also the first resource-level consumer of the existing `pageAll` pager, whose own error messages now render a non-numeric wire value as a fixed placeholder rather than interpolating it directly. No write path exists — `reconcile`/`delete` refuse via the existing typed `UnifiWriteRefused`, and the existing `GetOnlyHttpClient` wire guard and static write-op-reference test cover it without any change to either mechanism.

### Patch Changes

- [#310](https://github.com/taslabs-net/homeflare-kit/pull/310) [`77edfec`](https://github.com/taslabs-net/homeflare-kit/commit/77edfec37d0f48c98c0d9d8e047b690db6388ee5) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fixed `Proxmox.Vm`'s disk-drift check (`qemu-volume.ts`'s `judgeDisk`): it never recognized
  `<storage>:0,import-from=<volid>` (PVE's create-time spelling for importing a disk from another
  volume or a downloaded image) as a new-disk spelling, so it compared the declared literal volname
  `"0"` against PVE's live read-back of the real `vm-<vmid>-disk-<n>` it allocated on import and
  refused the update -- on the very deploy that created the disk (post-write verification reads the
  config right back) and on every plan after, since the declared value stays `import-from=...` for
  as long as the caller keeps declaring it that way.

  Found by homeflare-proxmox PR 84's red team against a real fake-PVE engine; tracked there as the
  `kit-disk-import-bug` blocker on `declareTalos`. `<storage>:0,import-from=<volid>` is now treated
  the same as the existing `<storage>:GiB` and `<storage>:cloudinit` new-disk spellings: it always
  matches whatever volume is already live in that slot, and no resize is ever attempted for it.

  Also fixes a LAND-stage red-team finding on this same change: options declared alongside
  `import-from` (e.g. `<storage>:0,import-from=<volid>,iothread=1`) are now recognized and enforced
  regardless of where they sit relative to `import-from`, instead of being silently dropped (declared
  after it) or stranding the disk with a forever-refused volname mismatch (declared before it).

## 0.39.0

### Minor Changes

- [#302](https://github.com/taslabs-net/homeflare-kit/pull/302) [`3f8a8af`](https://github.com/taslabs-net/homeflare-kit/commit/3f8a8af9df4dcdb0dd54be0f50f15d62e815b434) Thanks [@taslabs-net](https://github.com/taslabs-net)! - New `@homeflare/alchemy/telemetry`: `telemetryLayer`, an OTLP tracing/logging/metrics `Layer` a
  stack merges into its own `providers` — off unless given explicit `{ traces?, logs?, metrics? }`
  endpoints, no default collector anywhere in it. This is not alchemy's own CLI-wide telemetry
  (`otel.alchemy.run`, hard-coded, opted out via `~/.alchemy/telemetry-disabled`): it is a per-stack
  layer a consumer opts into with its own endpoints (the estate's Victoria stack, in homeflare-mini's
  case — this package names no estate host).

  Every span — a provider's own, effect's `HttpClient` client spans, and alchemy's own plan/apply
  engine spans — is redacted before export in two passes: `Tracer.Tracer` itself drops every HTTP
  header outright, strips every query string and blanks a consumer-supplied denylist of host/path
  segments (e.g. a UniFi console id) to `<redacted>`; a second pass at `OtlpSerialization` catches what
  that first pass cannot reach — a failed span's `exception.message`/`status.message` (built from the
  exit's `Cause` at export time) and a log line turned into a span event — by matching the denylist as
  a substring in that free text, and covers logs the same way. Bodies are protobuf-encoded, not
  JSON — VictoriaLogs/Metrics both reject the OTLP JSON encoding, silently, so the wire format is not
  a style choice. The transport is sealed — merging this layer into a stack's `providers` alongside a
  fetch-based provider (Caddy, LiteLLM, Forgejo) never lets its own `FetchHttpClient` leak into that
  provider's requirements, the same leak PR 293 fixed for Caddy's admin transport.

  See [docs/telemetry.md](../packages/alchemy/docs/telemetry.md) for how a consumer stack wires real
  endpoints in, and [docs/telemetry-spike.md](../packages/alchemy/docs/telemetry-spike.md) for what an
  offline spike against alchemy 2.0.0-beta.79's own engine measured actually arriving at a collector.

- [#296](https://github.com/taslabs-net/homeflare-kit/pull/296) [`4bdcc4f`](https://github.com/taslabs-net/homeflare-kit/commit/4bdcc4fc2340bea9696156b7b4ff4ef19eadfeff) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Forgejo.TeamMember` now declares `defaultRemovalPolicy: 'retain'`, matching `Forgejo.Repository`
  and `Forgejo.OrgLabel`. Previously the family had no default, so alchemy's own engine fallback
  (`destroy`) applied: dropping a `TeamMember` declaration from a stack — a feature gate toggled off,
  a resource id renamed — called `organization.orgRemoveTeamMember` and revoked a real membership on
  live Forgejo, with no way to tell from the declaration alone that this would happen. Found in
  `homeflare-mini` PR 82's red team (970e8be), which had to pipe every `ForgejoTeamMember(...)` call
  through `.pipe(RemovalPolicy.retain())` by hand to avoid dropping `forgejo-provision` from `Owners`.

  A stack that means to remove a real membership still can, with `.pipe(RemovalPolicy.destroy())` —
  `destroy` was, and stays, fully implemented. A stack already piping `RemovalPolicy.retain()` by hand
  (homeflare-mini) is unaffected; the pipe is now redundant, not wrong. Bumped as `minor`, not `patch`:
  this changes what removing a declaration does, not just an internal detail.

  ⚠️ **The new default does not protect an existing row until you deploy once first.** Alchemy plans
  a removal from the policy saved on that resource's state row, not from this default — the default
  only reaches an already-existing row's state on a deploy where the resource is otherwise a no-op
  (alchemy rewrites the row and logs `removal policy destroy → retain`). Concretely:

  - **To adopt retain for a `TeamMember` declared before this bump:** deploy the version bump first,
    with the declaration left in place (a no-op plan updates the saved policy). Only remove the
    declaration in a later deploy.
  - **Dropping the bump and the declaration in the SAME deploy still deletes the live membership** —
    the plan reads the row's old `destroy` policy, not this new default.
  - **To revoke a membership on purpose**, the sequence is unchanged: deploy with
    `.pipe(RemovalPolicy.destroy())` first, then remove the declaration in a later deploy.

- [#297](https://github.com/taslabs-net/homeflare-kit/pull/297) [`a821575`](https://github.com/taslabs-net/homeflare-kit/commit/a82157562aeea6fe06a2dd9382e131451411691e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Export `Proxmox.Vm` (`ProxmoxVm`) from the public barrel for Talos VMs: cpu/cores/sockets/memory,
  scsi disks on any storage (including `cephtb4`), `net0`/indexed NICs as a VLAN-aware bridge+tag,
  the cloud-init drive and `ipconfig0`, boot order, the guest agent and a serial console. Every field
  is managed only when declared (`qemu-props.ts`'s declared-keys model) — the fix for the
  "5-default PUT", where an update used to resend `cores`/`memory`/`name`/`onboot`/`sockets` with a
  hard default for whichever field the declaration left out, silently resetting it on an adopted VM.
  `cipassword` and `machine` can never be props (typed `never`, and refused at runtime if smuggled
  past the types). `ProxmoxVm` defaults to `RemovalPolicy.retain()`. Node-pinned semantics are
  unchanged: a VM found on another node still fails the plan ("A migration is not an update").

  Add `Proxmox.StorageDownload` (`ProxmoxStorageDownload`): a checksum-pinned `download-url` fetch
  onto a storage's `import` content, for staging a Talos boot image before a `Proxmox.Vm` references
  it as a disk source. `checksum`/`checksumAlgorithm` are required props (narrower than the vendor's
  own optional pair) and refused at runtime if left blank. There is no update path — PVE does not
  remember the `url`/`checksum` a volume was created from, so `filename` (with `storage`) is the
  identity: changing it plans a `replace` (the old file is deleted, the new one downloaded under its
  own name); a changed `checksum`/`url`/etc on the SAME `filename` is refused at plan time rather than
  silently accepted, since there is nothing left to verify it against. A failed download task (a
  checksum mismatch included) refuses the plan rather than reporting success. Delete is idempotent
  (a volume already gone is success) and not retained by default, since the file is reproducible from
  its own declaration.

  Both families are wired into the vendor constraint tables (`download-url`'s own
  `generated/constraints/pve-nodes-storage.ts`) and the ownership ledger, so a value the vendor would
  reject is refused at plan time. A live VM or file this stack holds no state for is never adopted or
  written without `--adopt` / `adopt(true)` (`ownership/probe.ts`'s `ownedRead`, `ownership/adopt.ts`'s
  `refuseTakeover`) — for `Proxmox.StorageDownload` this also guards its delete, since the family is
  not retained by default. A changed `vmid` on an already-managed `Proxmox.Vm` is refused as a
  different machine rather than planned as an update. Disk (`scsiN`/`ideN`) and NIC (`netN`) drift is
  now judged per key against the live volume id and live MAC (`qemu-volume.ts`/`qemu-net.ts`), so a
  declared "new disk" or MAC-less NIC no longer re-drifts (and gets rewritten) on every deploy after
  PVE allocates the real volume or generates the real MAC. Fixed a codegen gap surfaced by
  `download-url`'s `compression` parameter: an explicit vendor `"enum": null` (as opposed to an absent
  `enum`) was copied verbatim into the emitted table instead of being treated as no constraint.

### Patch Changes

- [#301](https://github.com/taslabs-net/homeflare-kit/pull/301) [`413f62b`](https://github.com/taslabs-net/homeflare-kit/commit/413f62b01ddb7e3fafb1f39f4b0153aa9ddadf5b) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Unifi.*` providers now refuse any non-`GET` request at the wire (`GetOnlyHttpClient`, installed in `unifiHandlers`), defense in depth alongside the existing per-operation write refusal, backed by a static test that bans any create/update/delete/patch/execute/remove/adopt SDK reference under `src/unifi`. Added `src/unifi/paginate.ts`'s consumer-side offset pager for the SDK's un-paginated list operations, and a pure `driftOf(live, props)` per family (`Unifi.Network`, `Unifi.FirewallZone`) reporting field-level drift for a future pre-import check.

## 0.38.0

### Minor Changes

- [#293](https://github.com/taslabs-net/homeflare-kit/pull/293) [`f11e6a6`](https://github.com/taslabs-net/homeflare-kit/commit/f11e6a6cae2ee4ca0a4604f4f23ecf1924351958) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `caddyProviders()` no longer merges Caddy's admin `HttpClient.HttpClient` (and `Credentials`) into
  the stack's own ambient context. Previously `caddyAdminLayer` `provideMerge`d Caddy's admin transport
  straight into `caddyProviders()`'s own Layer output; any other fetch-based provider merged into the
  same stack — `Layer.mergeAll(…, caddyProviders(), …, forgejoProviders())`, for example — could then
  resolve Caddy's admin `HttpClient.HttpClient` instead of the stack's real ambient one for its own
  `read`/`diff`/`reconcile` calls, misrouting its requests to Caddy's admin API. Affected: any stack
  that loads `caddyProviders()` alongside another fetch-based provider (homeflare-mini's `Forgejo.*`
  and `LiteLLM.PassThroughEndpoint` rows measured reading against Caddy's admin API instead of their
  own targets — verify's `read` came back absent/failed; writes were not exercised, so they are
  inferred from the same misrouted client, not separately measured).

  The admin transport's `Credentials`/`HttpClient.HttpClient` are now carried under a new house-only
  `CaddyAdminTransport` tag (never a generic platform service), and `CaddyConfigProvider()` provides
  them locally, scoped to exactly the effects that call `@distilled.cloud/caddy`'s operations. Caddy's
  own behaviour (unix socket and TCP admin, retries, timeouts, the admin guard) is unchanged.

  Public API narrowed: `caddyAdminLayer` now returns `Layer<CaddyAdminService | CaddyAdminTransport>`
  (previously it also carried `Credentials | HttpClient.HttpClient`), and `CaddyConfigProvider()` now
  requires `CaddyAdminTransport` instead of those SDK services directly. `caddyProviders()` and
  `localCaddyAdmin()` are unaffected; only code that wired `caddyAdminLayer`'s output by hand, or ran
  `@distilled.cloud/caddy` operations directly against it outside `caddyProviders()`, would need to
  change — no tray repo does this today. Bumped minor rather than patch because the package is 0.x and
  this narrows a public contract.

## 0.37.8

### Patch Changes

- [#290](https://github.com/taslabs-net/homeflare-kit/pull/290) [`6ddbff3`](https://github.com/taslabs-net/homeflare-kit/commit/6ddbff38096feecb36d3f0efe6efc0418e938145) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Podman.Container` no longer reads as an existing (and therefore "adopted") resource when its
  `.container` file is absent but a PLAIN unit that genuinely outranks Quadlet's generator in
  systemd's unit load path — `/etc/systemd/system` chief among them, never a vendor directory like
  `/usr/lib/systemd/system`, which is lower precedence than the generator and not a real shadow —
  already answers to the same service name. The read now refuses at plan time, naming the shadowing
  unit file and the fix (move it aside before declaring the container), instead of a create silently
  becoming an "adopted" plan whose eventual apply would leave the pre-existing plain unit running
  untouched while state recorded attributes read back from it. `verifyGenerated` is also hardened to
  check the same fact as a backstop at apply time, for the case this plan-time check does not cover.

- [#292](https://github.com/taslabs-net/homeflare-kit/pull/292) [`4225c4c`](https://github.com/taslabs-net/homeflare-kit/commit/4225c4c95dbf3e7e763c83565481487ef1a88212) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `sshSudoRunner` now lets `Podman.Container` reach its own Quadlet-generated unit: a generated
  unit's `FragmentPath` sits under a systemd generator's own output directory (`/run/systemd/generator`,
  never a declared prefix), but its `SourcePath` names the `.container` file that produced it — when
  that `SourcePath` is under a declared prefix, the runner elevates. Previously every generated unit
  was refused outright, so `Podman.Container` could never be restarted through this runner at all.

  `Systemd.Unit`'s validation now accepts leading blank lines and `#`/`;` comments before the first
  `[Section]`, per `systemd.syntax(7)` — a unit file systemd already loads could still fail
  `assertValid` if its first lines were comments. A genuine `key=value` line with no section still
  refuses.

  `Podman.Container`'s "the container's unit is NOT running" refusal message no longer asserts a
  running state it does not actually know (measured false for a refusal that ran before sudo did
  anything at all); it reads the unit's live state back and reports that instead.

## 0.37.7

### Patch Changes

- [#278](https://github.com/taslabs-net/homeflare-kit/pull/278) [`4b3c9eb`](https://github.com/taslabs-net/homeflare-kit/commit/4b3c9ebc0792386e797b2e1293b3c41cce4ddac7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Move Lxc reads, writes and task polling to named distilled operations. Preserve task
  credentials, ownership, digests, no-shrink checks and retention; prove absence with
  the exact SDK missing-config tag and the same credential's cluster-wide vmid check.

- [#283](https://github.com/taslabs-net/homeflare-kit/pull/283) [`a19c663`](https://github.com/taslabs-net/homeflare-kit/commit/a19c6632e3654c73fb3bf03dd9e2869b9ed65fdd) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Keep the PVE network `changes` sibling through the distilled protocol, and move NetworkApply onto named operations without storing the diff.

- [#278](https://github.com/taslabs-net/homeflare-kit/pull/278) [`4b3c9eb`](https://github.com/taslabs-net/homeflare-kit/commit/4b3c9ebc0792386e797b2e1293b3c41cce4ddac7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Move ReplicationJob and FirewallAlias lifecycle transport to named distilled SDK operations. Preserve no-write adoption, existing form and deletion semantics, and fail closed on unrelated errors or malformed reads.

- [#278](https://github.com/taslabs-net/homeflare-kit/pull/278) [`4b3c9eb`](https://github.com/taslabs-net/homeflare-kit/commit/4b3c9ebc0792386e797b2e1293b3c41cce4ddac7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fix two regressions from the distilled transport migration: ReplicationJob reads no
  longer fail closed when a SectionConfig release echoes guest/jobnum as text instead
  of a JSON number, and lxcTask's poll loop no longer aborts a still-running task on a
  status word other than exactly "running"/"stopped".

- [#282](https://github.com/taslabs-net/homeflare-kit/pull/282) [`08b1789`](https://github.com/taslabs-net/homeflare-kit/commit/08b1789cf835af177960aba5e4fbf16d007b087e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Move Proxmox.Vm onto named QEMU operations. Guest deletion uses the destroy route, and only the vendor missing-config error is absence.

- [#282](https://github.com/taslabs-net/homeflare-kit/pull/282) [`08b1789`](https://github.com/taslabs-net/homeflare-kit/commit/08b1789cf835af177960aba5e4fbf16d007b087e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fix a regression in the QEMU distilled transport migration: qemuTask's poll loop no
  longer aborts a still-running VM create/destroy on a status word other than exactly
  "running"/"stopped" (the same class of fix already shipped for lxcTask).

## 0.37.6

### Patch Changes

- [#276](https://github.com/taslabs-net/homeflare-kit/pull/276) [`0d9175d`](https://github.com/taslabs-net/homeflare-kit/commit/0d9175d89f5b05eea64da731affb4a5edc9b4e25) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Use the distilled OpenBao SDK for AppRole metadata reads, writes, deletes and rename
  collision checks. Preserve omitted role settings and existing no-op, ownership and deletion
  guards; permission and malformed-response failures never become absence. Reads and the
  metadata write retain the existing bounded transport retry — the write sends every managed
  field every time, so replaying it after a transport failure converges on the same role;
  delete makes one attempt. Checked against the OpenBao 2.6.2 generated AppRole schema and
  pinned vendor source. No login or credential issuance operations change.

- [#276](https://github.com/taslabs-net/homeflare-kit/pull/276) [`0d9175d`](https://github.com/taslabs-net/homeflare-kit/commit/0d9175d89f5b05eea64da731affb4a5edc9b4e25) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Run every OpenBao ACL policy lifecycle call, including rename collision reads, through
  the distilled OpenBao SDK. Preserve shared concurrency limits, agent sockets, runtime
  credentials, namespace selection, and token trace redaction. Only typed missing-policy
  errors mean absence; refused and malformed reads fail. Reads retain bounded transport
  retries; a policy write sends the full policy text every time, so it retries a transport
  failure the same bounded way; a delete makes one attempt after an uncertain response.
  Checked against the OpenBao 2.6.2 generated schema and pinned vendor policy handlers.

## 0.37.5

### Patch Changes

- [#285](https://github.com/taslabs-net/homeflare-kit/pull/285) [`e62f8e9`](https://github.com/taslabs-net/homeflare-kit/commit/e62f8e975b3c9a110a7e94c9c02644539e459600) Thanks [@taslabs-net](https://github.com/taslabs-net)! - LiteLLM pass-through calls use the fetch HTTP client, so a stack that also provides Caddy's admin client still reaches the proxy. Host.Directory recovers an interrupted create whose path was still an Output instead of crashing the next plan.

## 0.37.4

### Patch Changes

- [#280](https://github.com/taslabs-net/homeflare-kit/pull/280) [`2c8556e`](https://github.com/taslabs-net/homeflare-kit/commit/2c8556e7625d2596f41f238f2018c65df555bbc9) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Host.Directory on macOS no longer passes `--` to chmod and chown. Those BSD tools treat that token as a filename, so a first deploy created the directory and then failed the resource. Linux still passes `--`, which the sudo allowlist requires. mkdir and rmdir are unchanged.

  The archive inflater's source stream is typed as the chunk type DecompressionStream accepts, so the package typechecks under TypeScript 7. The bytes are unchanged.

- [#281](https://github.com/taslabs-net/homeflare-kit/pull/281) [`b0c9fc9`](https://github.com/taslabs-net/homeflare-kit/commit/b0c9fc9580463cff30c94efebe498b8cef7c9ddd) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `LiteLLM.PassThroughEndpoint` can be yielded from an Alchemy stack body. The proxy credentials stay on the provider layer, and that layer keeps them available when the engine calls the handlers.

## 0.37.3

### Patch Changes

- [#274](https://github.com/taslabs-net/homeflare-kit/pull/274) [`a740b7f`](https://github.com/taslabs-net/homeflare-kit/commit/a740b7fc64cf4f7ca7e60445fa9f2393b4aee664) - Run PBS notification matchers and sendmail, SMTP and webhook targets through the distilled
  Proxmox Backup Server SDK. Read failures now preserve their typed errors instead of planning
  false creates; only typed NotFound means absence or an already completed delete. Keep leased
  credentials, bounded requests, secret seals and no-op adoption. Vendor schema: PBS 4.2.6-1,
  SDK 0.3.1.

  Preflight replacement destinations, required write-only values and vendor/SDK input constraints
  before deleting a working target. Typed destination read failures stop replacement; existing
  renamed targets remain adoptable without requiring secret values the plan cannot observe.

- [#274](https://github.com/taslabs-net/homeflare-kit/pull/274) [`a740b7f`](https://github.com/taslabs-net/homeflare-kit/commit/a740b7fc64cf4f7ca7e60445fa9f2393b4aee664) - Run PBS datastore, prune, sync and verification providers through the distilled PBS SDK,
  using the proxmox-backup-server 4.2.6-1 schema. Preserve existing retention, parked-job,
  create-only and state semantics while allowing only typed missing-section errors to mean
  absence. Permission, transport and malformed-response failures now stop planning instead
  of suggesting a create or confirming a deletion.

- [#274](https://github.com/taslabs-net/homeflare-kit/pull/274) [`a740b7f`](https://github.com/taslabs-net/homeflare-kit/commit/a740b7fc64cf4f7ca7e60445fa9f2393b4aee664) - Use direct distilled SDK operations for PVE Pool, BackupJob and MetricServer lifecycle calls,
  walked against pve-manager 9.2.11. Only typed missing-object errors permit creation or idempotent
  deletion; authentication, permission and unrelated server failures propagate. Preserve existing
  adoption no-ops, retention normalization, omitted backup settings and metric-server secret fields.

- [#274](https://github.com/taslabs-net/homeflare-kit/pull/274) [`a740b7f`](https://github.com/taslabs-net/homeflare-kit/commit/a740b7fc64cf4f7ca7e60445fa9f2393b4aee664) - Move PVE notification targets and matchers onto generated distilled SDK operations.
  Failed reads now stop the plan; only typed NotFound means absence. Keep matching
  adoption write-free, preserve list items and explicit clearing, and validate read
  payloads without exposing server values. Identity changes replace the old resource;
  a same-name endpoint type change deletes first because names are shared across types.
  Preflight the destination and its vendor/SDK input constraints before replacement can
  delete a working target. Typed destination read failures stop replacement, while existing
  renamed targets remain adoptable without create-only secrets.

  Vendor schema: pve-manager 9.2.11. Read-only probes confirmed missing notification
  GETs return 404; write behavior is exercised through the real SDK and Alchemy engine
  against isolated fixtures, with no live notification changes.

## 0.37.2

### Patch Changes

- [#270](https://github.com/taslabs-net/homeflare-kit/pull/270) [`7710691`](https://github.com/taslabs-net/homeflare-kit/commit/77106917f0781d53bfedde224f71e7a7ad9b62bc) - Complete the CephFS transport migration to distilled Proxmox 0.3.0 (vendor schema
  pve-manager 9.2.11): send destructive DELETE flags through its corrected query binding
  and fold only the typed CephFsNotFound error. Preserve bounded task polling, safe
  omitted-flag defaults and the final live index read that proves deletion.

## 0.37.1

### Patch Changes

- [#268](https://github.com/taslabs-net/homeflare-kit/pull/268) [`7c9e674`](https://github.com/taslabs-net/homeflare-kit/commit/7c9e674545829191a560730924e557d5ccbb2bd2) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Use the distilled Proxmox SDK's typed missing-user, group, storage and Ceph-pool errors
  for absence. Propagate other cold-read/reconcile failures, and propagate failed Ceph
  filesystem and daemon index reads instead of treating them as missing resources.

  This prevents speculative creates after failed reads and prevents a CephFS delete
  from claiming success when its preflight or read-back cannot observe the filesystem.
  Existing confirmed-row User/Group/Storage checks and credential-denial reporting remain.
  Real-protocol fixtures cover expected absence and unrelated 401/403/500 errors; engine
  tests prove a failed cold read sends no create and a failed delete read is not success.
