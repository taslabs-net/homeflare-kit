# `Unifi.Network` write scope — what the one PUT may and may not do

`docs/unifi.md` describes the three-way update. This page records the limits placed on it after
the red team rounds 1 and 2 of PR 377. The only intended consumer is ONE VLAN's
`ipv6Configuration`: a patch may SET only `ipv6Configuration` and REMOVE only `ipv6Configuration`;
everything else a whole-object `PUT` could reach is refused with a typed error that carries field
names only, never values.

| refusal                         | when                                                                        |
| ------------------------------- | --------------------------------------------------------------------------- |
| `UnifiFieldNotSettable`         | a patch sets any key but `ipv6Configuration` (`enabled`, `dhcpGuarding`, …) |
| `UnifiFieldNotRemovable`        | a patch drops any key but `ipv6Configuration`                               |
| `UnifiManagementNetworkRefused` | the live object has `default: true` (the management LAN)                    |
| `UnifiImmutableFieldChanged`    | a patch sets or drops `zoneId`, `vlanId`, `management`, `deviceId`          |
| `UnifiIdentityChanged`          | `olds` names another `siteId`/`networkId` than `news`                       |
| `UnifiUpdateWouldBeNoop`        | the merged body equals live                                                 |

Every one of them fires after the live GET and before any PUT.

⛔ **Why a removable allowlist.** A key in `patch.unset` is deleted from the PUT body, and the
controller reads an omitted `dhcpGuarding`/`ipv4Configuration`/`ipv6Configuration` as "off". So
leaving a field out of a declaration would turn it off on the console. Only `ipv6Configuration`
(the block this path exists for, and the revert target) may be removed. `network-scope.ts` holds
the lists (`SETTABLE_KEYS`, `REMOVABLE_KEYS`, `IMMUTABLE_KEYS`); widening them is a kit change.

⚠️ **No version check: a hand edit between the read and the write is overwritten.** The PUT is the
live GET plus the patch, sent whole; the API offers no ETag or revision, so a change made on the
console between that GET and the PUT is replaced by the GET's copy. The window is one reconcile.

Non-USER `metadata.origin` is deliberately not handled: there is no rule for it yet.

## The wire guard (`wire-guard.ts`)

⛔ **The allowed PUT is anchored to the configured base URL**, not matched by suffix. The request
must share the base's origin, its path must be exactly `<base path>/v1/sites/<site>/networks/<id>`,
and it must carry no query string or fragment. `?force=true`, a nested
`/v1/sites/OTHER/v1/sites/s/networks/n`, a different base path and `//v1/...` all die before the
transport. `unifiHandlers` reads the base URL from the same `Credentials` the SDK uses; with none
the guard allows nothing.

⛔ **`redirect: 'manual'` is set per request, on the calling fiber's `RequestInit`, for EVERY
guarded request — GETs included — and any 3xx answer dies with `UnifiRefusedRequest`, whatever the
method.** Effect 4.0.1 `layerMergedContext` lets an outer `FetchHttpClient.RequestInit` REPLACE one
the layer provides, so a layer-provided `redirect: 'manual'` is silently lost under any consumer
that sets its own `RequestInit`. The guard reads the fiber's value and merges `redirect: 'manual'`
over it, the `openbao/bao-http.ts` `overSocket` pattern. `wire-guard-anchor.test.ts` proves it
against a real `Bun.serve` answering 301/302/303/307/308.

A GET's redirect is refused for the same reason a PUT's is, under both postures: fetch would
follow it and re-send the request — still carrying the API-key header — to a URL the guard never
vetted. Before the 2026-10-10 fix only reconcile's GETs ran `manual` (a 3xx surfaced raw and failed
the SDK decode) while `read`/`diff` followed it silently; one rule everywhere now, fail closed.

⛔ **Where a TLS `RequestInit` must live: on the CALLING FIBER**, provided around the program with
`Effect.provideService(FetchHttpClient.RequestInit, { tls: … })`, not inside the fetch layer's
build context (`FetchHttpClient.layer.pipe(Layer.provide(…))`). The guard re-provides `RequestInit` per
request, merged over the fiber's value, so an option set only inside the layer is overridden on every
guarded request, GETs included, and a consumer wired that way silently loses its TLS option (it
fails closed: the handshake is refused, nothing is sent insecurely).

⛔ **Backstop: the response URL must equal the request URL.** If a consumer's own transform provides
`RequestInit` WITHOUT merging, `manual` is lost and fetch follows a redirect. The guard dies when
`res.url` differs from `HttpClientRequest.toUrl(res.request)`. The allowed-path check likewise reads
`toUrl`, so a `setUrlParam` query is seen and refused. Tests: `wire-guard-round2.test.ts`.

⛔ **Refusal messages redact the cloud connector Console ID**: the path segment after `/consoles/`
becomes `<redacted>`.

## The static check (`write-op-reference.test.ts`)

It harvests the SDK's real write-op export names straight from its own service modules (every
name starting `create`/`update`/`delete`/`patch`/`execute`/`remove`/`adopt`) and fails any file
that mentions the SDK's package specifier and contains one of those names as a token anywhere — an
identifier, a bracket key, a destructured binding, a re-export or a dynamic-import property access
all read the same way, so one scan catches every syntax form without parsing which one it is. Its
`WRITE_OP_ALLOWLIST` is exactly `network-update.ts` → `updateNetwork`; any other file naming that
op, or that file naming `createNetwork`/`deleteNetwork`, is an offense.

## The PUT is attempted once

`updateNetwork` runs under `Retry.none`. The SDK's default policy would replay a write whose first
attempt may already have landed; a replay then runs against a controller state this reconcile never
read. A failure surfaces for the operator instead. Reads keep the default policy.

## After a PUT that landed

`UnifiUpdateDidNotConverge` means the PUT LANDED and live now differs from the declaration. It is
not rolled back. The next deploy sees drift and answers `UnifiLiveDriftedSinceDeploy`, whose
message names both causes (a hand edit, or an earlier non-converging PUT). Recovery in both cases
is a re-import of the live object.
