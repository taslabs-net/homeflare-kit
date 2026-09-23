---
'@homeflare/alchemy': patch
---

The `netbox/*` family (`Netbox.Prefix`) now calls `@distilled.cloud/netbox`'s
typed `ipam` operations instead of a hand-rolled `Effect HttpClient` client.
The old status-carrying `NetboxError` and its `cause.status === 404` check
are gone: `Netbox.Prefix` locates by a server-side list filter, which
`@distilled.cloud/netbox` never answers with a 404 (an empty page is a
normal 200), so nothing here checks a status code at all — a stronger
version of the same rule `catchTag('NotFound', …)` enforces for a
distilled-backed family that reads by direct key, like `forgejo/*`.
`client.ts` is gone; nothing else in this package imported it. The real
`@distilled.cloud/netbox` is not published upstream yet, so this package
aliases it onto `@homeflare/distilled-netbox@0.2.0` (built the distilled way
and shipped from this monorepo — see `docs/distilled-interim.md`) as a plain
`dependencies` entry, not a peer — nothing changes for a consumer's install.
Credentials still resolve from `NETBOX_URL` / `NETBOX_TOKEN` at call time,
now through the package's own `CredentialsFromEnv` layer. Props and
attributes are unchanged — an adopted prefix still plans noop.
