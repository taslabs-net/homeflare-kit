# @homeflare/distilled-caddy

## 0.2.2

### Patch Changes

- [#219](https://github.com/taslabs-net/homeflare-kit/pull/219) [`40c08eb`](https://github.com/taslabs-net/homeflare-kit/commit/40c08ebfc3ca04de7338deb95b217fbdce6c50d7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fixed `AdaptConfig`/`LoadConfig`: their `config` member is Caddyfile TEXT
  under whatever `contentType` names, a shape `T.HttpBody()` has no static
  `bodyMediaType` for because Caddy picks the media type at CALL time (its own
  `Content-Type` header) rather than at codegen time. `buildRequest`'s generic
  cascade has no branch for that, so a string `config` fell to its JSON-body
  default: `JSON.stringify`d the Caddyfile text (`file_server` became the
  13-byte quoted string `"file_server"`, which no adapter can parse) and
  overwrote the caller's `Content-Type` with `application/json`. MEASURED
  2026-09-23 against a bare `node:http` echo server:
  `adaptConfig({ config: "file_server\n", contentType: "text/caddyfile" })`
  sent `Content-Type: application/json` and a JSON-quoted body, not raw bytes
  under `text/caddyfile`.

  `protocol.ts`'s `encode` now rebuilds the request as raw text under the
  caller's own `Content-Type` (or Caddy's own `application/json` default when
  the caller left it unset) after `buildRequest` returns, for exactly these
  two operations. Every object-`config` operation (`createConfig`,
  `setConfig`, `setConfigById`, `replaceConfig`, …) is untouched — those really
  are JSON bodies, and `bodyJsonUnsafe` is correct for them.

  `src/protocol.ts` is copied verbatim from the distilled clone
  (`homeflare/caddy`, local commit `10d92b47`) per
  `packages/alchemy/docs/distilled-interim.md` — not hand-edited in the kit.
  This must land before `packages/alchemy/*` can migrate onto this package's
  typed operations (see the sibling changeset), since every text-config call
  the resource makes would otherwise ship the load-JSON-quoted-text bug into
  production.

## 0.2.0

### Minor Changes

- [#202](https://github.com/taslabs-net/homeflare-kit/pull/202) [`fbeb5f7`](https://github.com/taslabs-net/homeflare-kit/commit/fbeb5f71b319f472b6fa956d5fd486ce19dec078) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `@homeflare/distilled-caddy`, an unmodified copy of the (not yet
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
