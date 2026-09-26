---
'@homeflare/alchemy': minor
---

`caddyProviders()` no longer merges Caddy's admin `HttpClient.HttpClient` (and `Credentials`) into
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
