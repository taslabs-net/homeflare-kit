# Credentials

Moved out of the README (2026-09-21) to make room under its 200-line cap; the text is unchanged.

`CLOUDFLARE_API_TOKEN` is read from the environment at call time, never at module scope.
`MeshNode` instead resolves credentials and the account the way `Cloudflare.providers()` does
(an Alchemy profile, or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in CI).

⛔ **Mint a short-lived, scoped token** — do not reuse a long-lived one, and never a Global
API Key. An empty value fails closed with a message saying so, because an empty render is
a denied grant rather than a missing file, and `Bearer ` + nothing 401s in a way that reads
like a bad credential.

The Proxmox subpath mints every call's token from an OpenBao mount instead; see
[proxmox.md](./proxmox.md).

The Forgejo subpath (2026-09-23, moved onto `@distilled.cloud/forgejo`) resolves credentials
through the package's own `CredentialsFromEnv` layer, which reads `FORGEJO_URL` / `FORGEJO_TOKEN`
— the same two variable names the retired hand-rolled client read, still resolved on the calling
fiber per request, never captured at module scope. `Authorization: token <value>` (Forgejo's
access-token scheme, not `Bearer`) is built by the package's protocol layer, not by this package.

The NetBox subpath (2026-09-23, moved onto `@distilled.cloud/netbox` — see
[distilled-interim.md](./distilled-interim.md)) resolves credentials the same way, through the
SDK's own `CredentialsFromEnv` layer, which reads `NETBOX_URL` / `NETBOX_TOKEN` — the same two
variable names the retired hand-rolled `client.ts` read, still resolved on the calling fiber per
request, never captured at module scope. `Authorization: Token <value>` (NetBox's Django REST
Framework `TokenAuthentication` scheme — NOT `Bearer`, measured against this estate's own
instance) is built by the package's protocol layer, not by this package. ⛔ The token is never a
prop: Alchemy persists attributes unencrypted, so nothing stored in a stack file may be a
credential.
