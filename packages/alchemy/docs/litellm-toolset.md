# LiteLLM — `LiteLLM.Toolset`

One row of LiteLLM's MCP toolset table (`/v1/mcp/toolset`): a named selection of `{ server_id, tool_name }`
pairs a key or team can be granted instead of whole servers. Typed calls come from
`@distilled.cloud/litellm/mcp_management`, generated from LiteLLM **v1.103.0**; credentials and the
family's other refusals are in [litellm.md](./litellm.md).

Everything marked "read" was read from the **live 1.103.0 container's source** on 2026-09-30 (no request was
sent to a proxy). The docs page is docs.litellm.ai/docs/mcp_toolsets.

## The distilled operations it uses

Nothing is hand-rolled: every call is one of these, through `toolset-operations.ts`.

| step   | operation (`@distilled.cloud/litellm/mcp_management`) | route                                       |
| ------ | ----------------------------------------------------- | ------------------------------------------- |
| list   | `fetchMcpToolsetsV1McpToolsetGet`                     | `GET /v1/mcp/toolset`                       |
| read   | `fetchMcpToolsetV1McpToolsetToolsetIdGet`             | `GET /v1/mcp/toolset/{toolset_id}`          |
| create | `addMcpToolsetV1McpToolsetPost`                       | `POST /v1/mcp/toolset` (201)                |
| update | `editMcpToolsetV1McpToolsetPut`                       | `PUT /v1/mcp/toolset`                       |
| delete | `removeMcpToolsetV1McpToolsetToolsetIdDelete`         | `DELETE /v1/mcp/toolset/{toolset_id}` (202) |

## Example

```ts
import { LiteLLMToolset, litellmProviders } from '@homeflare/alchemy/litellm';

export class Web extends LiteLLMToolset('Web', {
  toolsetName: 'estate-web',
  description: 'Search and fetch only',
  tools: [
    { serverId: search.serverId, toolName: 'query' }, // LiteLLM.MCPServer outputs
    { serverId: docs.serverId, toolName: 'fetch' },
  ],
}) {}

// A team or key is granted it by ID (not name), through its object permission:
//   LiteLLM.Team('Estate', { objectPermission: { mcpToolsets: [Web.toolsetId] }, … })
```

Then provide `litellmProviders()` alongside the stack's other providers. A toolset is served at
`/toolset/{toolset_name}/mcp` and as `litellm_proxy/mcp/<toolset_name>`.

## Behaviour

| Concern     | Rule                                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity    | `toolset_name` is unique (a create or rename onto a taken name is a 409). The id is a uuid the **proxy** issues (`create_mcp_toolset`); the create request has no id field. |
| Adopt       | A live row with no state is `Unowned` and needs `--adopt`; found by name from the list. A matching row writes nothing.                                                      |
| Rename      | An update of the same row, never a replace.                                                                                                                                 |
| Tools       | Always compared, as a set of pairs; an adopted toolset with more is corrected. `[]` is an explicit empty selection. Required, so the declaration always says.               |
| Description | Compared only when declared: adopting never clears text a person wrote. Blank is refused.                                                                                   |
| Update      | Partial: absent keeps, `null` clears, **except** a `null` name or `tools`, which change nothing. So `tools` is only ever sent as a list, and only when it differs.          |
| Removal     | `defaultRemovalPolicy: 'retain'`. Opt in with `RemovalPolicy.destroy()`. Deleting a toolset does **not** detach it: a team or key holding its id keeps a dangling grant.    |
| Delete      | Idempotent by a real read: a failed DELETE is swallowed only when a by-id read says the row is gone. A 403 (PROXY_ADMIN only) re-raises the original error.                 |
| Write check | Reconcile reads back **by id** and fails (`LitellmRegistryNotConvergedError` / `…AbsentAfterWriteError`) if a declared field did not land or the row is not there.          |

## The list cannot prove absence, so nothing but adoption uses it

⛔ Measured in the source (`toolset_db.py` lines 111-117, `mcp_management_endpoints.py`): `list_mcp_toolsets`
wraps its query in `except Exception: … return []`, so a **database error answers an empty list with a 200**;
and the route narrows the list to the caller's granted toolsets unless the caller is an admin. The by-id
route reads the table (`get_mcp_toolset`, a `find_unique`) and answers 404 only for a missing row.

So the list is used **only to adopt by name**, and every read of a toolset this stack already owns is by id.
A wrong "absent" from the list can only end in a create, which a unique name turns into a 409 that fails the
deploy (`toolset.test.ts`).

## Refused before any request

A blank or padded `toolsetName`; a name containing `/` (a toolset is served at `/toolset/{toolset_name}/mcp`,
`proxy_server.py` line 19346, so that name could never be addressed; LiteLLM itself accepts one); a blank
`description`; a `tools` that is not a list; a blank or padded `serverId` or `toolName`; the same pair twice.

## Licence gating (measured)

None. `mcp_management_endpoints.py` and `toolset_db.py` have no `premium_user` reference (`grep -ci premium`:
0 in both), and the docs page makes no Enterprise statement. Writes need PROXY_ADMIN (403 otherwise).

## Not modelled

Nothing: the table has no other column a write reaches. What is **not validated by LiteLLM**, and so not by
this resource: that a `serverId` exists, or that the server has a tool of that name. A dangling pair is stored
and silently grants nothing.

## Unmeasured at 1.103.0

No live proxy was contacted. The fake (`fake-toolset-litellm.ts`) is built from the source; each choice is in
its header. Not exercised: the caller-scoped narrowing of the list, and how the SDK's `{ body: unknown }`
typing meets a real 201 with a body (the fake answers 201 and the tests pass through the real SDK decode).
The typed fix for this tag's undeclared 404 and 409 is a distilled patch, which belongs in the distilled
clone and is not part of this change.
