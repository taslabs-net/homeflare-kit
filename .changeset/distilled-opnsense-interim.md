---
'@homeflare/distilled-opnsense': minor
---

Add `@homeflare/distilled-opnsense`, an unmodified copy of the (not yet
upstream-published) `@distilled.cloud/opnsense` SDK — 83 operations across 8
API controllers (Firewall Alias/Category/Group/Filter, Routing Gateways, the
`os-frr` plugin's Quagga/BGP), generated from OPNsense's own MVC model XML
and API controller PHP (`opnsense/core`/`opnsense/plugins` tag `26.7.2` —
OPNsense publishes no OpenAPI document at all, so this converter reads the
vendor's model/controller source directly, unlike every other
distilled-sourced package in this kit). Typed, `catchTag`-able errors cover
OPNsense's three-shape 200-with-failure vendor pattern plus its genuine
non-2xx shapes.

This is the fourth package on the kit's interim-package route established by
`@homeflare/distilled-netbox` — see `packages/alchemy/docs/distilled-interim.md`.
This PR does not alias `@distilled.cloud/opnsense` onto it and does not
declare any Alchemy `Resource`s on top — that is a follow-up PR, gated in
part on two open intent questions in `docs/alchemy-ledger-network.md` in the
landscape repo.

The kit's own typecheck (real, unlike the distilled clone's repo-wide
`noCheck`) and `scripts/smoke.ts` caught two bugs never exercised before:
`errors.ts`'s `Schema.Record({key, value})` used the wrong call shape for
this `effect` rc, and `credentials.ts`'s `normalizeBaseUrl` doubled every
request's path to `/api/api/...` (the same class of bug netbox's own
`normalizeBaseUrl` review caught, PR #183). Both are fixed here and in the
distilled clone.
