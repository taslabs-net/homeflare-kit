---
'@homeflare/typesafe': minor
---

`createTypeSafeGatewayClient`'s gateway transport now refuses a Jev version mismatch
instead of silently answering with a different version, and defaults gateway logging
off. Decision 23/24 (Tim, 2026-09-23).

Behaviour change: pass an explicit `model` (anything other than the aliases
`jev-latest` / `jev-preview`) and, if Cloudflare's AI Gateway answers with a different
version, `systemOne()` now rejects with the SDK's `UnprocessableEntityError` — narrow it
with the new `modelMismatchOf(err)` — rather than returning the wrong version's answer.
The refusal is a synthetic response built locally (never thrown from the fetch adapter),
so it is not retried and does not cost a second billed call; it happens only after
Cloudflare has already run and billed the mismatched call, since this route has no way
to check the version beforehand (measured against the catalog's own input/output JSON
Schemas, unchanged since kit PR #150). An alias, or an omitted `model` (the SDK defaults
it to `jev-latest`), is never refused. Every response — refusal included — now carries
the answering model on a new `x-homeflare-gateway-model` header, alongside the existing
`x-homeflare-gateway-key-source`.

Also new: `collectLog?: boolean` on `TypeSafeGatewayOptions`, default `false`, sending
`cf-aig-collect-log: false` so the gateway keeps no log entry for a call unless the
caller opts in with `collectLog: true`. Neither this header nor any of the transport's
other five can be added or overridden by the SDK's `defaultHeaders` or a per-call
`headers` option — the adapter builds its outgoing header set itself and never reads
headers the SDK computed.

No generated types changed. `docs.typesafe.ai/models.md`'s alias list (`jev-latest`,
`jev-preview`) is the only new vendor-schema input, cited with provenance in
`src/gateway-model.ts`.
