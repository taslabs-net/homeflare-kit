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
