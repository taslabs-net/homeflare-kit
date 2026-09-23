# @homeflare/typesafe

## 0.2.0

### Minor Changes

- [#150](https://github.com/taslabs-net/homeflare-kit/pull/150) [`9ace17c`](https://github.com/taslabs-net/homeflare-kit/commit/9ace17ce2556a8f77f8721b276f668ca6e755321) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `createTypeSafeGatewayClient`: builds the official `TypeSafeClient` wired through Cloudflare's AI Gateway catalog route instead of a direct `api.typesafe.ai` key, for a consumer that holds TypeSafe's key only as BYOK behind a gateway. It returns a plain `TypeSafeClient` — `systemOne()`, retries, parsing and error classes stay the official SDK's, satisfying this package's "not a replacement client" rule — and swaps only where the bytes go, through the SDK's own `TypeSafeClientConfig.fetch` transport hook. Sends exactly `Authorization`, `cf-aig-gateway-id`, `cf-aig-no-wholesale: true`, `Content-Type` and `Accept`; drops the SDK's own `Authorization`/`X-TypeSafe-*`/`User-Agent` headers, none of which the measured route accepts. Version pinning is unavailable on this route — Cloudflare's `typesafe/jev` catalog input schema has no `model` property — so a requested model is read and silently dropped rather than forwarded or refused; the version that actually answered is always in the response body's `model` field, and which BYOK key answered is readable via `.withResponse()` on the `x-homeflare-gateway-key-source` header. `models.list()` and anything but `systemOne()` get a `NotFoundError` locally, with no network call, since the catalog route covers only that one call.

## 0.1.0

### Minor Changes

- [#53](https://github.com/taslabs-net/homeflare-kit/pull/53) [`c9ebb0f`](https://github.com/taslabs-net/homeflare-kit/commit/c9ebb0fed4b667f83b3493f485026920d379f0b4) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `@homeflare/typesafe`: the official TypeSafe System One SDK, pinned and constructed with an explicit Worker secret. Not a replacement client.
