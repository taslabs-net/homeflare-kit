# Why this provider keeps its bounded RESP client

Source audit: `alchemy@2.0.0-beta.79`, 2026-10-01. Upstream **does** export
`connect(url)` and typed `Redis.CommandError`; the earlier claim that no reusable client
existed was incomplete. The exception is the provider's bounds, not missing commands.

- [`Redis/Protocol.ts:287–311`](https://github.com/alchemy-run/alchemy/blob/v2.0.0-beta.79/packages/alchemy/src/Redis/Protocol.ts#L287)
  waits on `Queue.take` without a deadline. `connect` (lines 321–346) accepts only a URL,
  uses an unbounded event queue and constructs its parser internally. There is no timeout or
  byte-limit option. An Effect timeout could bound elapsed time, but cannot inspect or bound
  allocations inside that parser before a reply completes.
- [`Redis/Resp.ts:63–65`](https://github.com/alchemy-run/alchemy/blob/v2.0.0-beta.79/packages/alchemy/src/Redis/Resp.ts#L63)
  caps individual bulks at 512 MiB and aggregates at 1,000,000 elements. These are real caps,
  but not the provider's 1 MiB / 10,000 element caps. `Parser.push` (lines 563–575) appends
  bytes before decoding, with no total reply cap.
- [`Redis/Protocol.ts:54–64`](https://github.com/alchemy-run/alchemy/blob/v2.0.0-beta.79/packages/alchemy/src/Redis/Protocol.ts#L54)
  builds a URL containing the password; `connect` parses that string to authenticate. The
  provider keeps credentials separate from endpoint strings and never puts them in state.
  A URL can be kept in memory, so this alone would not prevent adoption of the helper.

Measured by `src/valkey/upstream-bounds.test.ts`: the pinned upstream parser accepts a bulk
above 1 MiB and an array above 10,000 elements. This test needs no network listener. The
provider's `transport-bounds.test.ts` verifies its stricter refusals and deadlines. Replacing
it with upstream plus a post-decode size check would remove the pre-allocation protection.

The exception can go away when upstream exposes configurable connect/read deadlines and
parser/queue caps (or a bounded transport injection point). Until then `transport.ts` and
`resp.ts` remain internal, with typed `ValkeyServerError` / `ValkeySocketError`, and one
socket per scoped operation. This is not a general-purpose Redis client.
