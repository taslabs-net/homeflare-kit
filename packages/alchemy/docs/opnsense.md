# OPNsense — `@homeflare/alchemy/opnsense`

Declares `Opnsense.Firewall.Alias`, `.Category` and `.Group` against
`@distilled.cloud/opnsense` (aliased onto `@homeflare/distilled-opnsense@0.2.0` —
[`distilled-interim.md`](./distilled-interim.md)). Built 2026-09-24. **READ-ONLY BY
DESIGN** — see "The policy" below before reading anything else here. This is the
estate's **edge firewall**: nothing in this family, or in building it, contacted
the live box, and nothing about it may reconfigure one.

## Vendor version — inferred, never measured

`@homeflare/distilled-opnsense`'s own README states its pin: generated against
`opnsense/core`/`opnsense/plugins` tag `26.7.2`, **inferred** from a captured
package list, not measured live (SSH to the edge is forbidden by house policy —
a failed probe gets the caller's IP CrowdSec-banned). Keep that caveat attached to
every OPNsense claim this family makes; patch releases inside one series rarely
change model/controller shape, but "rarely" is not "measured".

## Resource set, and why these three

The SDK covers 8 controllers / 83 operations (Firewall Alias/Category/Group/Filter,
Routing Gateways, and the `os-frr` plugin's Quagga/BGP). This first import pass
picks the three whose SDK module exports BOTH a `get()` (the whole model, keyed by
uuid) and a `search<Item>` operation (a paginated list, OPNsense's own POST-shaped
read) — genuine "list and get" configuration objects, not runtime state:

- **Built**: `firewall_alias`, `firewall_category`, `firewall_group` (interface
  groups, not permission groups).
- **Skipped, and why**:
  - `firewall_filter` (rules) and `routing_settings` (gateways) export `get()` but
    no `search*` — no distinct list operation, so they miss this pass's own bar.
    Rules are also the most consequential, highest-churn object in the model;
    deferred to its own pass rather than folded in here.
  - `quagga_general` is a global settings singleton, not a collection of items —
    no uuid, nothing to adopt "by id".
  - `quagga_bgp` mixes several item types (aspath, communitylist, neighbor,
    peergroup, prefixlist, redistribution, routemap) with no `search*` for any of
    them — deferred as a unit rather than picking one sub-type arbitrarily.
  - `quagga_service` is pure runtime control (start/stop/restart/status) — the
    task's own "not runtime state" exclusion, textbook case.

## Why `get()`, never `getItem`/`searchItem`, for the three that shipped

`get()` returns the WHOLE model tree in one GET —
`{ alias: { aliases: { alias: { <uuid>: AliasItem, ... } } } }` for Alias, and the
equivalent nesting for Category/Group (see each resource file's header for the
exact path). Finding one item by uuid is then an object-key lookup, never an
ambiguous request.

That sidesteps two real gaps MEASURED in this early SDK, not a stylistic choice:

1. **`firewall_alias` has no per-item get at all** — only `get` (whole model) and
   `searchAlias` (paginated) exist.
2. **`firewall_category`/`firewall_group` DO export `getCategory`/`getGroup`**,
   but their generated request schema carries no `uuid` path parameter at all
   (`GetCategoryRequest`/`GetGroupRequest` are both `S.Struct({})` against a `uri`
   with no `{uuid}` placeholder) — a generation gap in this SDK, not a design
   choice. Filed as an SDK gap below rather than worked around with a raw path.

`searchAlias`/`searchCategory`/`searchGroup` were also passed over for `list()`
building (they stay unused) because their generated request schema exposes no
typed limit/offset/searchPhrase at all — a large object set could silently
page-truncate through a naive use of them, where `get()` has no pagination to
fall short of.

## The policy: reconcile and delete always refuse

Tim, 2026-09-24: UniFi and OPNsense are read-only for now. `policy.ts`'s
`OpnsenseWriteRefused` is the ONLY error `reconcile`/`delete` can raise on any of
the three resources — neither handler imports an `add`/`set`/`del`/`toggle`
operation from the SDK. `reconcile` still observes with one `get()` first, so the
refusal can say whether it would have created or updated; `delete` observes
nothing and refuses unconditionally. `write-refusal.test.ts` proves it with a fake
HTTP client that fails the test itself on any non-GET request, exercised through
the exact `handlers` object each resource's `Provider` wraps — not a lower-level
seam a real provider bypasses.

Lifting this is a kit change (edit `policy.ts`, write the create/update/delete
bodies these resources do not have), never a prop. There is no `allowWrite` flag.

## Adopt is `adopt(true)`, not silent (S7, S8, H1)

None of Alias, Category or Group carries an ownership marker OPNsense itself
understands. Following upstream's `Snippet.ts` reference for a marker-less API
(the same posture `../discord` documents, not NetBox's silent-adopt gap): a cold
read (no persisted `output`) that finds a live object at the declared uuid
returns `Unowned(attrs)`, so declaring it fails `OwnedBySomeoneElse` **unless**
`adopt(true)` is set. Each resource's convenience constructor
(`firewallAlias`/`firewallCategory`/`firewallGroup`) pipes `adopt(true)` on by
default (H5).

## The declaration renderer

`aliasPropsFromLive`/`categoryPropsFromLive`/`groupPropsFromLive` (the barrel's
names for each resource file's `propsFromLive`, itself the same function as
`attributesOf` — see each `*-form.ts`'s header) are pure: given the uuid `get()`'s
map key names and the item decoded at that key, they return exactly the props a
declaration needs so `matches` reports noop against it. A future import script
iterates `Object.entries(map)` from one `get()` call and calls the matching
renderer once per row to generate an `alchemy.run.ts` row — no such script ships
in this change.

## Credentials

`OPNSENSE_URL` / `OPNSENSE_API_KEY` / `OPNSENSE_API_SECRET`, read **at call time**
via `@distilled.cloud/opnsense/Credentials`'s own `CredentialsFromEnv` (Basic
auth, the vendor's own scheme), re-exported from `credentials.ts` rather than
re-implemented. No OpenBao mint yet (H8's target is unreleased); a deploy process
exports the three variables itself today. This package never reads, logs or
mints them.

## SDK gaps

- 🔴 **`getCategory`/`getGroup`'s missing `uuid` path parameter** (above) — a
  distilled generation gap, not exercised by this family, worth fixing upstream
  in the distilled clone before a later pass tries to use either operation.
- **No vendor constraint table**, unlike NetBox/Paperless — this pass did not
  walk `vendor-schema` for OPNsense's field limits (e.g. `CategoryItem.color`'s
  `/^[0-9a-fA-F]{6}$/` pattern); a malformed declaration would only be caught if
  writes were ever lifted, not at plan time.
- **`password`/`username`/`authtype`/`expire`** (the URL-fetch alias credential
  fields) and **`path_expression`** (`urljson`-only) are left off `AliasProps`
  entirely — S25 for the first four, narrow scope for the fifth. See
  `alias-form.ts`'s header.
- **No live lifecycle test** (H12): tests run against `fake-opnsense.ts`, a
  loopback fake, not the real edge. This task had no credentials and was told
  not to look for any.
