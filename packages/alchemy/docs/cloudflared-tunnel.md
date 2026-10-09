# CloudflaredTunnel — a Cloudflare Tunnel without its token in state

`CloudflaredTunnel` (`Cloudflare.CloudflaredTunnel`) declares a Cloudflare Tunnel of the cloudflared
kind (`cfd_tunnel`): the object whose `<id>.cfargotunnel.com` target DNS records point at and whose
remote configuration holds the ingress rules. It declares **the tunnel object only**: no ingress
rules, no routes, no DNS record, no connector Deployment. Those are separate declarations that name
this tunnel's `id`. Read 2026-10-09 against `alchemy@2.0.0-beta.81` and
`@distilled.cloud/cloudflare@1.0.0-rc.13`.

## Why not `Cloudflare.Tunnel.Tunnel`

- ⛔ **It puts the connector token in state.** Its `reconcile`, `read` and `list` call
  `getTunnelCloudflaredToken` and keep the result as `token: Redacted<string>`
  (`alchemy/src/Cloudflare/Tunnel/Tunnel.ts`). Alchemy's state encoder writes a `Redacted` value as
  `{"__redacted__": "<the value>"}` (`alchemy/src/State/StateEncoding.ts`, `encodeState`, which
  LocalState, HttpStateStore and PostgresState all call before writing). The state store is not
  encrypted, and the token is what `cloudflared tunnel run --token` accepts, so anyone who can read
  state can run a connector for the tunnel and receive its traffic.
- **Its plans need a Write token.** The token endpoint needs a Write permission, so even a plan
  would. `CloudflaredTunnel` never calls it, so a plan runs on a read token.

`CloudflaredTunnel` follows the same pattern as [MeshNode](./mesh-node.md): attributes with no
secret, adoption by exact name, `retain` by default. The type string is `CloudflaredTunnel`, not
`Tunnel`, so it cannot be confused with upstream's `Cloudflare.Tunnel.Tunnel` in a stack that uses both.

## Declaring a tunnel

```ts
import { CloudflaredTunnel, providers as homeflareCloudflare } from '@homeflare/alchemy/cloudflare';

// providers: Layer.mergeAll(Cloudflare.providers(), homeflareCloudflare()),
const admin = yield * CloudflaredTunnel('k8s-admin', { name: 'k8s-admin' });
// admin.id → the tunnel UUID: `${admin.id}.cfargotunnel.com` is the DNS target
```

| prop   | type     | notes                                                                 |
| ------ | -------- | --------------------------------------------------------------------- |
| `name` | `string` | Unique per account. The identity used for adoption. Renames in place. |

Attributes: `id`, `accountId`, `name` and `status` (`inactive`, `degraded`, `healthy` or `down`, as
of the last read or write). ⛔ There is no token, secret or `tunnelSecret` attribute, and none is
sent: Cloudflare generates and keeps the tunnel secret. `accountId` is not a secret; it is what
`read` and `delete` address, so they never act on whatever account the environment names today.

The account and credentials come from Alchemy's own Cloudflare environment
(`Cloudflare.CloudflareApiLive()`): an Alchemy profile, or `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in CI.

### Remotely configured only

The tunnel is always created with `config_src: "cloudflare"` (managed through the API and the Zero
Trust dashboard), sent explicitly. The SDK types the field as optional (`local` or `cloudflare`)
and does not document the default (`CreateTunnelCloudflaredRequest`, `zero_trust.ts`). It is
create-only: the PATCH body has `name` and `tunnelSecret` only. A tunnel found by name whose
`config_src` is `local` is **refused on adoption** with a sentence and left untouched, because its
ingress is a YAML file on its origin and remote rules would be accepted and never applied.
⚠️ UNVERIFIED: that every real GET/list response carries `config_src`. A response without it is
accepted; only an explicit `local` is refused.

## The token is not this resource's business

Whatever installs the connector fetches the token at that moment and hands it straight to the
workload's secret store (`GET /accounts/{id}/cfd_tunnel/{id}/token`, which needs a Write
permission). It must not go into Alchemy state, a log line or a CI variable. No function in this
package calls that endpoint, `observe` copies named fields only, and
`cloudflared-tunnel-state.test.ts` proves the persisted state holds no token. ⚠️ Never deploy with
`DISTILLED_DEBUG_HTTP` set: distilled prints the start of every response body.

## What each change does

| change                 | answer                  | what happens on Cloudflare                                         |
| ---------------------- | ----------------------- | ------------------------------------------------------------------ |
| `name`                 | `update`                | `PATCH`. The id, connectors and `cfargotunnel.com` target survive. |
| account (provider env) | `replace`, create-first | A new tunnel in the new account. Under `retain` the old one stays. |
| nothing                | none                    | Zero writes, and no token read: a plan is GETs and one list only.  |

⛔ **Removal policy: `retain` by default**, like MeshNode and the other kit resources whose deletion
breaks their consumers. Deleting a tunnel drops its remote configuration and orphans every DNS record
that targets it; a new tunnel has a new id and token. Dropping the declaration or `alchemy destroy`
leaves the tunnel live and only drops it from state. Opt a declaration into deletion with
`.pipe(RemovalPolicy.destroy())`. ⚠️ Under `retain` an account-change replace leaves the old tunnel
live and unmanaged.

## Adoption

An existing tunnel is found by **exact** name among `cfd_tunnel`s and returned `Unowned`. Alchemy
refuses to take it over until the resource is wrapped in `adopt(true)` (or `--adopt` is passed). A
deleted tunnel, a tunnel of another type (a `warp_connector` Mesh node shares the name space) and a
prefix match are never matched, and a name that matches two live tunnels is refused. Adoption is
idempotent: the adopted row holds the id, so a repeat deploy takes the owned path and writes
nothing. Without `adopt(true)`, a create whose name is held by another tunnel refuses and names the
holder; it never converges on it, and the sentence says not to delete it.

An interrupted create (the tunnel was made, its state was not saved) is found the same way on the
next plan, so it too needs `adopt(true)`. ⚠️ distilled retries a create after a lost response or a
5xx, and the retry is answered code 1013 by the tunnel the first attempt made: the error then names
that tunnel's id and is not adopted silently, because a concurrent creator looks the same.

## Deleting

`delete` runs only under `RemovalPolicy.destroy()`. It addresses the **stored id and account**,
never a name: it reads that id first, does nothing when the tunnel is already gone or soft-deleted,
and refuses an empty id before any request. The API refuses a delete while connectors are attached
("The tunnel must have no active connections", the SDK's own doc on `deleteTunnelCloudflared`); that
error passes through unchanged, so scale cloudflared to zero first. No retry loop is added: a
connector does not detach within seconds on its own. ⚠️ Whether the API answers a delete of an
already-deleted tunnel with 404 / code 1002 is unmeasured here; the pre-read makes it moot.

`list` is empty and `nuke` skips this type: Alchemy's own `Tunnel.Tunnel` already enumerates every
`cfd_tunnel` for `alchemy unsafe nuke` (fetching each token to do it), and a second listing would
delete each tunnel twice.

## Tests

Four files in `src/cloudflare/` run the provider against a fake API (`fake-tunnel.ts`) that hands out
a token on every surface it can:

- `cloudflared-tunnel.test.ts`: the lifecycle; the create body is `{name, config_src}` and no
  request ever touches `/token`.
- `cloudflared-tunnel-edges.test.ts`: each refusal and recovery, written to fail when its guard
  is deleted.
- `cloudflared-tunnel-state.test.ts`: Alchemy's real plan/apply, then `encodeState` over the stored
  rows: no `__redacted__` marker, no `token` key, no token value, with a negative control showing
  the same encoder does write a `Redacted` token. Also the removal policy and adoption.
