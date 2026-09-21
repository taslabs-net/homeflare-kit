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

## What each change does

| change                   | answer                      | what happens on Cloudflare                                                |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------- |
| `name`                   | `update`                    | `PATCH`. The id, token, enrolled replicas and Mesh IPs all survive.       |
| `ha`, same `name`        | `replace`, **delete-first** | The old node is deleted, then the new one is created under the same name. |
| `ha` and `name` together | `replace`, create-first     | The new node is created, then the old one is deleted.                     |
| account (provider env)   | `replace`, create-first     | Names are unique per account, so the two generations cannot collide.      |

⛔ **An `ha` replace is an outage for that node.** The new node has a new id and a new token, and
each replica gets a new Mesh IP. Re-enrol every replica with the new token, and update anything
that pins the old Mesh IP (Gateway rules, listener allow-lists) in the same change.

★ **Why delete-first only when the name stays.** The new node needs the name the old one holds, so
creating first would fail with code 1013 (`DuplicateTunnelName`). ⚠️ Unmeasured: whether a
just-deleted node frees its name at once. If it does not, the create fails with code 1013 and a
sentence; deploy again once the name is free. An invalid declaration is refused at plan time,
before anything is deleted.

⚠️ **Removal policy.** The default is Alchemy's `destroy`, so removing the declaration deletes the
node. Under `RemovalPolicy.retain()` the delete-first teardown is skipped, the old node keeps its
name, and the create **refuses** with a sentence. It never quietly reuses the old node, because
that node would still have the old `ha`.

⚠️ Cloudflare may refuse to delete a node while replicas are connected. This is noted in Alchemy's
WarpConnector and was not measured here. Stop the client on every replica before a destroy or an
`ha` replace.

## Adoption

An existing node is found by **exact** name and returned `Unowned`. Alchemy refuses to take it
over until the resource is wrapped in `adopt(true)` (or `--adopt` is passed). A deleted node is
never matched, and a name that matches two live nodes is refused.

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

## Permissions

| step                    | needs (any one, per the API reference)                                      |
| ----------------------- | --------------------------------------------------------------------------- |
| plan / read (get, list) | Cloudflare One Connectors Read, or Cloudflare One Connector: WARP Read      |
| create, rename, delete  | Cloudflare One Connectors Write, or Cloudflare One Connector: WARP Write    |
| `fetchMeshNodeToken`    | Cloudflare One Connectors Write (or the cloudflared or Tunnel Write groups) |

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
