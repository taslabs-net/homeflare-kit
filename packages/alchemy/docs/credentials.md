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

The Paperless subpath (2026-09-24, moved onto `@distilled.cloud/paperless-ngx` — same route) also
resolves credentials through the SDK's own `CredentialsFromEnv`, reading `PAPERLESS_URL` /
`PAPERLESS_TOKEN` — the same two variable names the retired hand-rolled `credentials.ts` read.
`Authorization: Token <value>` (Paperless-ngx's own DRF `TokenAuthentication`, same scheme as
NetBox) is built by the package's protocol layer. Baked directly into each of the four
`xxxProvider()`s (`paperlessProviders()` no longer takes a credentials-layer override — see the
migration's changeset), the same way the Forgejo and NetBox subpaths above do.

The LiteLLM subpath (2026-09-24, moved onto `@distilled.cloud/litellm` — see
[distilled-interim.md](./distilled-interim.md)) resolves credentials the same way, through the
SDK's own `CredentialsFromEnv` layer, which reads `LITELLM_PROXY_URL` / `LITELLM_PROXY_API_KEY` —
the same two variable names the retired hand-rolled `credentials.ts` read (LiteLLM's own `litellm`
CLI client's variable names, not a house choice), still resolved on the calling fiber per request,
never captured at module scope. `Authorization: Bearer <value>` is built by the package's protocol
layer, not by this package. ⛔ The key is never a prop, for the same reason as above.

The Discord subpath (2026-09-24, new — `@distilled.cloud/discord`, no prior hand-rolled client)
resolves credentials through the SDK's own `CredentialsFromEnv` layer, which reads
`DISCORD_BOT_TOKEN` (falling back to `DISCORD_TOKEN`), resolved on the calling fiber per request,
never captured at module scope. `Authorization: Bot <value>` is built by the package's protocol
layer. On CT100, `hf-discord-halibut.service` holds its own bot token at
`/opt/homeflare/env/discord-halibut.env`; this package never reads that file. ⛔ The token is
never a prop, for the same reason as above. See [discord.md](./discord.md) for the live census
this credential would let a deploy act against.

The Google Workspace subpath (new 2026-09-24, on `@distilled.cloud/google-workspace`) resolves
credentials through the SDK's own `CredentialsFromEnv`, which reads `GOOGLE_ACCESS_TOKEN` — but
unlike NetBox/Forgejo/Paperless/LiteLLM's API-token schemes, this variable holds an OAuth2 bearer
access token the SDK does not know how to mint: no ADC, no service-account signing, no refresh
flow. A Bun wrapper (H8's shape, unwritten by this package) performs the domain-wide-delegation
JWT exchange against a service-account key in OpenBao and exports the short-lived result into
this one variable. `Authorization: Bearer <value>` is still built by the package's protocol layer.
`GoogleWorkspaceKeyRef`/`describeKeyRef` (this subpath's own `credentials.ts`) are a typed,
key-free REFERENCE to where that service-account key lives, for a stack file to keep alongside its
declarations — full setup: [google-workspace.md](./google-workspace.md).

The Argo CD subpath (new 2026-09-24, `@distilled.cloud/argocd`, built ahead of any live instance)
resolves credentials the same way, through the SDK's own `CredentialsFromEnv` layer, which reads
`ARGOCD_TOKEN` (required) and `ARGOCD_SERVER` (optional instance origin, default
`https://localhost:8080`) — the package's own names, unchanged. `Authorization: Bearer <value>` is
built by the package's protocol layer. The repository/cluster CREDENTIALS this subpath's three
resources declare (a repo's password/SSH key, a cluster's bearer token/TLS key) are a separate,
per-object concern from the instance's own API token above — write-only `FromEnv` references, never
a prop or attribute either: see [argocd.md](./argocd.md#secrets-never-in-state).
