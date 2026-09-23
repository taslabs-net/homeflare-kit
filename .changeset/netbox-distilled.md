---
'@homeflare/alchemy': patch
---

The `netbox/*` family (`Netbox.Prefix`) now calls `@distilled.cloud/netbox`'s
typed `ipam` operations instead of a hand-rolled `Effect HttpClient` client —
`catchTag('NotFound', …)` in place of a status-carrying `NetboxError`.
`client.ts` is gone; nothing else in this package imported it. The real
`@distilled.cloud/netbox` is not published upstream yet, so this package
aliases it onto `@homeflare/distilled-netbox@0.2.0` (built the distilled way
and shipped from this monorepo — see `docs/distilled-interim.md`) as a plain
`dependencies` entry, not a peer — nothing changes for a consumer's install.
Credentials still resolve from `NETBOX_URL` / `NETBOX_TOKEN` at call time,
now through the package's own `CredentialsFromEnv` layer. Props and
attributes are unchanged — an adopted prefix still plans noop.
