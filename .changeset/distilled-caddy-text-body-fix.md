---
'@homeflare/distilled-caddy': patch
---

Fixed `AdaptConfig`/`LoadConfig`: their `config` member is Caddyfile TEXT
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
