---
'@homeflare/distilled-unifi-network': minor
---

Add `@homeflare/distilled-unifi-network`, an unmodified copy of the (not yet
upstream-published) `@distilled.cloud/unifi-network` SDK — 73 operations
across 44 paths (13 API tags), generated from Ubiquiti's own UniFi Network
**Integration API** OpenAPI 3.1.0 document (10.4.57; the vendor publishes no
stable, anonymously-fetchable spec URL, so this copy is an operator export
from a console's own web UI, with its `servers` block already stripped — a
console's `servers[0].url` embeds an account-identifying console id that
must never be committed). ~67 of the spec's polymorphic (discriminator +
`allOf`) schemas are flattened into optional fields on their base, since the
spec has zero `oneOf`/`anyOf` for the generator to hook a union into; the
spec documents zero error responses on any operation, so every operation's
error channel is the shared HTTP-status-dispatched set instead.

Follows the interim-package route `@homeflare/distilled-netbox` (#183),
`@homeflare/distilled-proxmox` (#185) and `@homeflare/distilled-paperless-ngx`
(#188) already established — see
`packages/alchemy/docs/distilled-interim.md`. This PR does not alias
`@distilled.cloud/unifi-network` onto it and adds no kit provider — the
alias can only resolve once this package is actually on npm, and a UniFi
provider family is its own follow-up work. The package's own README and
`docs/codegen-notes.md` (copied from the distilled clone) record the
resource-level traps (whole-object PUT, ordering-list endpoints, adopt-only
objects, hardware-affecting writes) a future provider must not ignore, and
the `X-API-KEY` header this SDK sends is unverified against a live console —
this PR ships a separate, unrun auth-probe handoff script for that.
