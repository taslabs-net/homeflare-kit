# MeshNode — a Cloudflare Mesh node without its token in state

`MeshNode` (`Cloudflare.MeshNode`) declares a Cloudflare Mesh node: the `warp_connector` object
that a Linux host joins with the Cloudflare One Client. `fetchMeshNodeToken` fetches the node's
enrolment token on demand, for a one-off enrolment step. Read 2026-09-21 against
`alchemy@2.0.0-beta.79`, `@distilled.cloud/cloudflare@1.0.0-rc.12` and Cloudflare's Mesh docs.

## Why not `Cloudflare.Tunnel.WarpConnector`

- ⛔ **It puts the node token in state.** Its `toAttributes` calls the token endpoint on every
  `read`, `reconcile` and `list`, and stores the result as an attribute. `Redacted` keeps it out
  of logs, not out of the state store. The token lets any Linux host join the account's Mesh as
  that node.
- **It has no `ha` prop.** High availability can only be chosen when the node is created.
- **Its plans need a Write token.** The token endpoint requires "Cloudflare One Connectors Write"
  (or the cloudflared or Tunnel Write groups). `MeshNode` never calls it, so a plan can run on a
  read token.

## Declaring a node

```ts
import * as Cloudflare from 'alchemy/Cloudflare';
import { MeshNode, providers as homeflareCloudflare } from '@homeflare/alchemy/cloudflare';

// providers: Layer.mergeAll(Cloudflare.providers(), homeflareCloudflare()),
const door = yield * MeshNode('vault-door', { name: 'door-a', ha: false });
```

| prop   | type      | notes                                                                             |
| ------ | --------- | --------------------------------------------------------------------------------- |
| `name` | `string`  | Unique per account. The identity used for adoption. Renames in place.             |
| `ha`   | `boolean` | **Required, create-only.** The API default is `false`, the dashboard's is `true`. |

Attributes: `id` (the node UUID), `accountId`, `name`, `status` (`inactive`, `degraded`,
`healthy` or `down`, as of the last read or write) and `ha`. ⛔ There is no token attribute.

The account and credentials come from Alchemy's own Cloudflare environment
(`Cloudflare.CloudflareApiLive()`): an Alchemy profile, or `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in CI. So the node lands in the same account as the `Gateway.Rule` and
`DNS.Record` resources that refer to it. `providers()` builds that layer itself, so the provider
works whether or not the stack also merges `Cloudflare.providers()`.

⛔ **Removal policy: `retain` by default**, like the kit's other resources whose deletion breaks
their consumers. Dropping the declaration or `alchemy destroy` leaves the node live and only drops
it from state. Opt a declaration into deletion with `.pipe(RemovalPolicy.destroy())`.

### Choosing `ha`: a door is `ha: false`

HA fails over the CIDR **routes** a node advertises. A node with no routes (a door: callers dial
its Mesh IP) gains nothing from it, because the Mesh IP belongs to each replica: "Nodes without
routes do not benefit from HA failover" (Cloudflare's Mesh HA page, read 2026-09-21). After a
failover the promoted replica answers on its own Mesh IP, so nothing dialling the first one
follows it.

So a door is `ha: false`, and **a second door is a second `MeshNode`** with its own name, token
and Mesh IP. Callers list both addresses. Keep `ha: true` for a subnet gateway with routes, on a
device profile that uses MASQUE.

## What each change does

| change                   | answer                      | what happens on Cloudflare                                                                  |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------- |
| `name`                   | `update`                    | `PATCH`. The id, token, enrolled replicas and Mesh IPs all survive.                         |
| `ha`, same `name`        | `replace`, **delete-first** | `retain` (default): **refused**, nothing written. `destroy`: old deleted, then new created. |
| `ha` and `name` together | `replace`, create-first     | The new node is created. Under `retain` the old one stays live.                             |
| account (provider env)   | `replace`, create-first     | As above; names are unique per account, so the two cannot collide.                          |

⛔ **An `ha` replace is an outage for that node.** The new node has a new id and a new token, and
each replica gets a new Mesh IP. Re-enrol every replica with the new token, and update anything
that pins the old Mesh IP (Gateway rules, listener allow-lists) in the same change.

★ **Why delete-first only when the name stays.** The new node needs the name the old one holds, so
creating first would fail with code 1013 (`DuplicateTunnelName`). ⚠️ Unmeasured: whether a
just-deleted node frees its name at once. If it does not, the create fails with code 1013 and a
sentence; deploy again once the name is free. An invalid declaration is refused at plan time,
before anything is deleted.

### An `ha` change under `retain`

`retain` also skips the old node's delete inside a replace. So a same-name `ha` change keeps the old
node, which still holds the name, and the create **refuses** with a sentence and writes nothing. It
never quietly reuses the old node, because that node still has the old `ha`. Measured through
Alchemy's own plan/apply in `mesh-node-policy.test.ts`:

| you want             | do                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| the replace          | Deploy once with `.pipe(RemovalPolicy.destroy())`: delete, then create. Then drop it.                                |
| the replace, by hand | Delete the old node yourself, then deploy again.                                                                     |
| to keep the old node | `alchemy state rm <stack>/<stage>/<id>` (state only, not the node), then deploy the old declaration + `adopt(true)`. |

⚠️ **Reverting `ha` is not enough.** The refused deploy leaves a `replacing` row, and the next
plan resumes that replace whatever the props say, so it refuses again.

⚠️ Never deploy with `DISTILLED_DEBUG_HTTP` set: distilled prints the start of every response,
and the create response carries the node's `token` field (Cloudflare's HA page says so).

⚠️ Cloudflare may refuse to delete a node while replicas are connected. This is noted in Alchemy's
WarpConnector and was not measured here. Stop the client on every replica before a destroy or an
`ha` replace.

## Adoption

An existing node is found by **exact** name and returned `Unowned`. Alchemy refuses to take it
over until the resource is wrapped in `adopt(true)` (or `--adopt` is passed). A deleted node is
never matched, and a name that matches two live nodes is refused.

An interrupted create (the node was made, its state was not saved) is found the same way on the
next plan, so it too needs `adopt(true)`. ⚠️ distilled retries a create after a lost response or a
5xx, and the retry is answered code 1013 by the node the first attempt made: the error then names
that node's id. It is never adopted silently, because a concurrent creator looks the same.

⚠️ **Adoption records the declared `ha`.** No documented read returns a node's HA flag:
`GET /warp_connector/{id}` has no such field. Check the node's **HA** badge in the dashboard
before adopting. A wrong value cannot be detected by any later plan.

## Enrolling a host: `fetchMeshNodeToken`

The token is a runtime credential. It never goes into Alchemy state or the vault; it goes straight
to the host that runs the node. A one-off Bun `mesh-enroll` step:

```ts
import { fromApiToken } from '@distilled.cloud/cloudflare/Credentials';
import { fetchMeshNodeToken } from '@homeflare/alchemy/cloudflare';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { open } from 'node:fs/promises';

const token = await Effect.runPromise(
  fetchMeshNodeToken({ accountId, id: nodeId }).pipe(
    Effect.provide(Layer.mergeAll(fromApiToken({ apiToken }), FetchHttpClient.layer)),
  ),
);
// ⛔ Created 0600 from the start, as root: no window where a chmod has not happened yet.
const file = await open('/root/mesh-node.token', 'wx', 0o600);
await file.writeFile(Redacted.value(token));
await file.close();
```

- `{ accountId, name }` works too; the name is matched exactly.
- The value comes back `Redacted`: `console.log`, `Effect.log` and `JSON.stringify` show
  `<redacted>`. Call `Redacted.value` only at the write.
- ⛔ **`fromApiToken`, not `Credentials.fromEnv()`.** `fromEnv` falls back to the Global API Key
  (`CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL`) when no token is set.
- ⚠️ **The endpoint needs a Write permission.** Mint a short-lived token for this step alone. A
  read token gets a 403, and the error names the permission.
- ⚠️ `warp-cli --accept-tos connector new <token>` (Mesh get-started page) takes the token as an
  **argument**, so it is visible in the host's process list while that command runs. Run it as
  root on the node itself, in a shell that does not keep history.
- An empty token fails closed. An empty file would otherwise "enrol" a host that never joined.
- ⛔ **Refused before any request:** `DISTILLED_DEBUG_HTTP` set (distilled then prints the first
  400 characters of every response body to stderr, which is the whole token), the Global API Key
  (`apiKey` credentials), and an empty API token (a denied secrets grant, not a permission).

## Permissions

| step                    | needs (any one, per the API reference)                                   |
| ----------------------- | ------------------------------------------------------------------------ |
| plan / read (get, list) | Cloudflare One Connectors Read, or Cloudflare One Connector: WARP Read   |
| create, rename, delete  | Cloudflare One Connectors Write, or Cloudflare One Connector: WARP Write |
| `fetchMeshNodeToken`    | Cloudflare One Connectors Write (see below)                              |

The token endpoint's API reference lists Connectors Write, "Cloudflare One Connector: cloudflared
Write" and "Cloudflare Tunnel Write"; the Mesh get-started guide lists Connectors Write and
"Cloudflare One Connector: WARP Write". Connectors Write is the one both name.

## Not covered here

- **Routes, device profiles and Gateway rules:** use Alchemy's `Tunnel.Route`,
  `Devices.CustomProfile` and `Gateway.Rule`. ⚠️ HA needs MASQUE on the node's device profile.
- **The HA provider configuration** (`/warp_connector/{id}/configurations`: `ha_mode` of `none`,
  `disabled`, `aws` or `local` with VIPs) and **manual failover**. Its semantics for a node
  created without `ha` are undocumented, so this resource neither reads nor writes it.
- **Mesh IPs.** They belong to each replica (the `/connections` endpoint), not to the node, so
  they are not attributes. Pin them in site config and check them against the API.
- **`alchemy unsafe nuke`.** `list` is empty and nuke skips this type, because Alchemy's own
  WarpConnector provider already lists every `warp_connector` in the account.
