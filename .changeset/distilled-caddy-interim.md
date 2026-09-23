---
'@homeflare/distilled-caddy': minor
---

Add `@homeflare/distilled-caddy`, an unmodified copy of the (not yet
upstream-published) `@distilled.cloud/caddy` SDK — Caddy's admin API (13
operations: `/load`, `/adapt`, `/stop`, `/config/[path]`, `/id/<id>[path]`,
`/pki/ca/<id>[/certificates]`, `GET /reverse_proxy/upstreams`) plus typed
shapes for Caddy's config tree (`Config`, `AdminConfig`, `Logging`, the
`http`/`tls` apps' servers/routes/handlers/matchers as module references)
generated from Caddy's separate, unversioned config-structure API and
restricted to the modules the house Caddy binary (2.11.4) actually has —
see the distilled clone's `packages/caddy/docs/config-tree.md`. Caddy
publishes no OpenAPI/Smithy/GraphQL description for the admin API itself,
so every operation shape is hand-transcribed from `caddyserver/caddy`
v2.11.4 Go source with a provenance comment per shape (the distilled
clone's `packages/caddy/docs/provenance.md`), then run through the same
`finalizeConvert` reference check and smithy→SDK compiler every other
`@distilled.cloud/*` package uses.

Follows the kit's interim-package route (`packages/alchemy/docs/distilled-interim.md`,
established by `@homeflare/distilled-netbox`). This PR does not alias
`@distilled.cloud/caddy` onto it and does not move the kit's existing
hand-written `packages/alchemy/src/caddy/*` provider — the alias can only
resolve once this package is actually on npm; that migration is a
follow-up PR.
