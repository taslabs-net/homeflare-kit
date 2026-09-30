# LiteLLM — `LiteLLM.AccessGroup`

One row of LiteLLM's **unified access group** table (`LiteLLM_AccessGroupTable`,
`/v1/unified_access_group`): a named bundle of models and MCP servers that teams and keys are attached to.
Typed calls come from `@distilled.cloud/litellm/access_groups`, generated from LiteLLM **v1.103.0**;
credentials and the family's other refusals are in [litellm.md](./litellm.md).

Everything below marked "read" was read from the **live 1.103.0 container's source** on 2026-09-30 (no
request was sent to a proxy). What the docs page says is cited by URL.

## Which "access group" this is

LiteLLM uses the words for three different things. This resource is the first.

| Thing                    | Where it lives                                         | Holds                       |
| ------------------------ | ------------------------------------------------------ | --------------------------- |
| **Unified access group** | `LiteLLM_AccessGroupTable`, `/v1/unified_access_group` | models, MCP servers, agents |
| Model access group       | `access_groups` in a model's `model_info`              | models only                 |
| MCP access group         | a bare name on an MCP server row (`mcp_access_groups`) | MCP servers by name         |

⚠️ **Toolsets are not in a unified group.** `AccessGroupCreateRequest` (`litellm/types/access_group.py`)
has `access_model_names`, `access_mcp_server_ids`, `access_agent_ids`, `assigned_team_ids` and
`assigned_key_ids`, and nothing else. A toolset is granted through `object_permission.mcp_toolsets` on a
team or key ([litellm-team.md](./litellm-team.md)).
The docs agree: docs.litellm.ai/docs/proxy/access_groups lists models, MCP servers and agents.

## The distilled operations it uses

Nothing is hand-rolled: every call is one of these, through `access-group-operations.ts`.

| step   | operation (`@distilled.cloud/litellm/access_groups`)       | route                                 |
| ------ | ---------------------------------------------------------- | ------------------------------------- |
| list   | `listAccessGroupsV1UnifiedAccessGroupGet`                  | `GET /v1/unified_access_group`        |
| create | `createAccessGroupV1UnifiedAccessGroupPost`                | `POST /v1/unified_access_group` (201) |
| update | `updateAccessGroupV1UnifiedAccessGroupAccessGroupIdPut`    | `PUT /v1/unified_access_group/{id}`   |
| delete | `deleteAccessGroupV1UnifiedAccessGroupAccessGroupIdDelete` | `DELETE …/{id}` (204, no body)        |

Not used: the by-id `GET` (a missing id is a 404 this tag does not declare; the list decides absence
without it), and the `/v1/access_group` routes (registered as aliases of these on the same handlers,
`access_group_endpoints.py`, "Alias routes").

## Example

```ts
import { LiteLLMAccessGroup, litellmProviders } from '@homeflare/alchemy/litellm';

// An existing group, adopted by its name (needs --adopt), made to grant exactly this.
export class Estate extends LiteLLMAccessGroup('Estate', {
  accessGroupName: 'estate',
  description: 'Models and tools every estate seat may use',
  modelNames: ['cf-code', 'cf-flash'],
  mcpServerIds: [docs.serverId], // a LiteLLM.MCPServer: the dependency edge is the Output
}) {}
```

Then provide `litellmProviders()` alongside the stack's other providers.

## Behaviour

| Concern     | Rule                                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity    | `access_group_name` is **unique** (`find_unique`, a duplicate is a 409), so the name finds the one row. The id is the proxy's (a uuid) and is what state remembers.         |
| Adopt       | A live row with no state is `Unowned`; it needs `--adopt`. A matching row writes nothing.                                                                                   |
| Rename      | An update of the same row (the id does not change), never a replace.                                                                                                        |
| Grants      | `modelNames` and `mcpServerIds` are **always compared**, as sets; an undeclared list means "grants nothing". An adopted group that grants more than declared is corrected.  |
| Description | Compared only when declared: adopting never clears text a person wrote. Blank is refused.                                                                                   |
| Update      | Partial (`exclude_unset`, a `null` list becomes `[]`), so only the fields that differ are sent. Team and key edges, agents and `access_agent_ids` are never in the body.    |
| Removal     | `defaultRemovalPolicy: 'retain'`. Opt in with `RemovalPolicy.destroy()`. Deleting a group **detaches it from every team and key** that holds it (`delete_access_group`).    |
| Delete      | Idempotent by a real read: a failed DELETE is swallowed only when the list no longer has the id. A 403 (PROXY_ADMIN only) re-raises the original error.                     |
| Write check | Reconcile lists again and fails (`LitellmRegistryNotConvergedError`) if a declared field did not land, or (`LitellmRegistryAbsentAfterWriteError`) if the row is not there. |

## Team and key membership is declared on the other side

`assigned_team_ids` and `assigned_key_ids` are **not modelled**. A team's group membership is
`LiteLLM.Team`'s `accessGroupIds`, and LiteLLM mirrors it into the group's `assigned_team_ids` in the same
transaction (`_sync_add_access_group_to_teams`). Two resources writing one edge would fight, so the group
never sends either field, and an adopted group keeps whatever it has there.

⚠️ **LiteLLM edits `access_model_names` itself.** Unified groups store model **names**, and
`management_helpers/access_group_model_sync.py` removes a name from every group when its last deployment is
deleted (and renames it when a deployment is renamed). A model removed elsewhere therefore shows up as a
plan difference on the next change. Alchemy plans from state and reads live rows only to adopt (beta.79), so
the correction lands on the next deploy that changes the group at all, not on its own.

## Refused before any request

A blank or padded `accessGroupName`; a blank `description`; a blank, padded or repeated entry in
`modelNames` or `mcpServerIds`.

## Licence gating (measured)

None. `access_group_endpoints.py` has no `premium_user` check (`grep -ci premium`: 0), and the docs page makes
no Enterprise statement. Writes need PROXY_ADMIN (`_require_proxy_admin`, 403), reads admin or admin-view.

## Not modelled

`assigned_team_ids`, `assigned_key_ids`, `access_agent_ids`; nothing validates that a model name or a server
id exists (LiteLLM stores them raw), so a dangling id is accepted and silently grants nothing.

## Unmeasured at 1.103.0

No live proxy was contacted. The fake (`fake-access-group-litellm.ts`) is built from the source and the
generated schema; each choice it makes is in its header. Whether the list is paged, and what the by-id
`GET` answers for a missing id, were not exercised. The typed fix for the undeclared 404 and 409 of this tag
is a distilled patch, which belongs in the distilled clone and is not part of this change.
