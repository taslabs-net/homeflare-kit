---
'@homeflare/alchemy': minor
---

Aliases four more distilled interim SDKs onto `@homeflare/alchemy`'s
`dependencies`, following `docs/distilled-interim.md`'s step 5:
`@distilled.cloud/proxmox-backup`, `@distilled.cloud/paperless-ngx`,
`@distilled.cloud/litellm` and `@distilled.cloud/caddy`, each aliased onto
its published `@homeflare/distilled-<vendor>` interim copy (kit PRs #200,
#194/#195, #201, #202) at its current workspace version — not opnsense or
unifi-network, neither of which is aliased anywhere yet. No resource in this
package imports any of the four yet; that migration is each family's own
later PR, per `distilled-interim.md`'s "what NOT to do".

The root `build:interim-packages` script (kept root-level and non-nested,
the CI-race fix from kit PR #193) is now generic: it discovers which
`packages/distilled-*` copies to build by scanning every workspace
manifest's `dependencies` for a `"@distilled.cloud/<vendor>":
"npm:@homeflare/distilled-<vendor>@<version>"` alias, instead of a
hard-coded netbox/proxmox list — a new alias needs no edit to this script.
`tests/catalog.test.ts`'s `EXACT_PEERS` table is now derived the same way
for every `distilled-*` interim copy (`effect` alone, one reasoning comment
kept in one place) instead of one hand-added entry and comment per vendor,
which had become a recurring merge-conflict hot spot across concurrent
interim-package PRs landing the same night.

This is a `minor`, not a `patch`: `@homeflare/alchemy`'s own `dependencies`
gained four new runtime entries, even though no exported code changed.
