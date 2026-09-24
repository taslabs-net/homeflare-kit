---
'@homeflare/alchemy': patch
---

The `caddy/*` family (`Caddy.Config`, `caddyWithFile`, `localCaddyAdmin`) now calls
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
