---
'@homeflare/alchemy': minor
---

Add `MeshNode` (`Cloudflare.MeshNode`) and `fetchMeshNodeToken` to `@homeflare/alchemy/cloudflare`.

- **`MeshNode`** declares a Cloudflare Mesh node (a `warp_connector`) with `name` and `ha`. It never reads the node token, so the token never reaches Alchemy state. Alchemy's `Cloudflare.Tunnel.WarpConnector` fetches it on every read and stores it, and it has no `ha`. The attributes are `id`, `accountId`, `name`, `status` and `ha`.
  - A `name` change renames the node in place (`PATCH`), keeping its id, token and enrolled replicas.
  - `ha` is required and create-only (Cloudflare: "cannot be changed afterward"). A change replaces the node: delete-first while the name stays (names are unique per account), create-first when the name changes too. An account change is a create-first replace.
  - **It defaults to `RemovalPolicy.retain`**, like the kit's other resources whose deletion breaks their consumers: deleting a node cuts every enrolled replica off the Mesh, and a new one means a new token and Mesh IPs. Dropping the declaration or `alchemy destroy` leaves the node live. Opt in with `.pipe(RemovalPolicy.destroy())`.
  - Under that default a same-name `ha` change **refuses and writes nothing**: the engine keeps the old node, which still holds the name, and a create never reuses a node it did not create (that would record the wrong `ha`). The sentence names the ways on: deploy once with `.pipe(RemovalPolicy.destroy())` (delete-first), delete the old node by hand, or keep it (`alchemy state rm` the row, then `adopt(true)`; reverting `ha` alone refuses again). A create-first replace leaves the old node live. All measured through Alchemy's real plan/apply against the fake.
  - A door (a node with no routes) is documented as `ha: false`: HA fails over routes, and each replica has its own Mesh IP. A second door is a second `MeshNode`.
  - An existing node is adopted by exact name and returned `Unowned`. A create answered code 1013 after a clean lookup (distilled retries a create whose response was lost) names the node that appeared rather than blaming another tunnel type.
  - `list` is empty and `nuke` skips the type, because Alchemy's WarpConnector already lists every `warp_connector`.
- **`fetchMeshNodeToken({ accountId, id | name })`** returns the node token `Redacted`, on demand, for a one-off enrolment step. Callers write it to a root-owned `0600` file on the node and nowhere else. An empty token fails, and a 403 names the Write permission the endpoint needs. Before any request it refuses the Global API Key, an empty API token, and a set `DISTILLED_DEBUG_HTTP` (distilled would print the token to stderr).
- Built on `@distilled.cloud/cloudflare`, the SDK Alchemy's own Cloudflare providers use. The `cloudflare@4.5.0` SDK cannot create an HA node. It is a new **required peer**, pinned to the version alchemy pins (`1.0.0-rc.12`): add it to your install line.
- `providers()` now also resolves Alchemy's Cloudflare credentials and account for `MeshNode`, the same way `Cloudflare.providers()` does (a profile, or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`).

Guide: `docs/mesh-node.md`.
