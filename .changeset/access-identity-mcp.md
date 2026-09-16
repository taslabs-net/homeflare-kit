---
'@homeflare/cloudflare': minor
'@homeflare/kit': patch
'@homeflare/alchemy': patch
---

Add `accessIdentity` (ctx.access) and RFC 9728 MCP discovery; fix three doc defects.

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
