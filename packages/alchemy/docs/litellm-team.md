# LiteLLM — `LiteLLM.Team`

One row of LiteLLM's team table (`LiteLLM_TeamTable`, `/team/*`): the **models, MCP grants and member roster**
that bound every key of a team. Typed calls come from `@distilled.cloud/litellm/team_management`, generated
from LiteLLM **v1.103.0**; credentials and the family's other refusals are in [litellm.md](./litellm.md).

Everything marked "read" was read from the **live 1.103.0 container's source** on 2026-09-30 (no request was
sent to a proxy). Docs: docs.litellm.ai/docs/mcp_grant_access, /docs/proxy/users.

## The distilled operations it uses

Nothing is hand-rolled: every call is one of these, through `team-operations.ts`.

| step   | operation (`@distilled.cloud/litellm/team_management`) | route                                       |
| ------ | ------------------------------------------------------ | ------------------------------------------- |
| read   | `getTeamInfoTeamInfo`                                  | `GET /team/info?team_id=`                   |
| create | `postNewTeamTeamNew`                                   | `POST /team/new`                            |
| update | `updateTeamTeamUpdatePost`                             | `POST /team/update`                         |
| add    | `teamMemberAddTeamMemberAddPost`                       | `POST /team/member_add`                     |
| role   | `teamMemberUpdateTeamMemberUpdatePost`                 | `POST /team/member_update`                  |
| delete | `deleteTeamTeamDeletePost`                             | `POST /team/delete`                         |
| list   | `listTeamTeamListGet`                                  | `GET /team/list` (only to confirm a delete) |

## Example

```ts
import { LiteLLMTeam, litellmProviders } from '@homeflare/alchemy/litellm';

export class Estate extends LiteLLMTeam('Estate', {
  teamId: 'example-estate', // adopts the live team (needs --adopt)
  teamAlias: 'example-estate',
  models: ['cf-code', 'cf-flash'],
  accessGroupIds: [group.accessGroupId],
  objectPermission: {
    mcpServers: [], // ⛔ see "the MCP ceiling": leave the team list empty
    mcpToolsets: [web.toolsetId], // toolset IDS
    blockedTools: ['estate_shell-run'],
  },
  members: [{ userId: 'tim' }],
}) {}
```

## ⛔ The team's `mcpServers` is a ceiling that intersects every key's grants

Where both a team and a key list servers, **the key reaches only the intersection** (`user_api_key_auth_mcp.py`
lines 1482-1503; docs.litellm.ai/docs/mcp_grant_access). "An empty set means this level does not restrict."
A NON-EMPTY team `mcpServers` therefore silently removes access from any key granted a server the team does
not list. The fix for a team that carries one is to declare `mcpServers: []` and grant servers on keys, on
toolsets (`mcpToolsets`) or through unified access groups. This resource does not decide that: it makes it a
reviewed line of source. `mcpToolPermissions`, `mcpToolsets` and `mcpAccessGroups` are separate fields with
their own rules (`mcp_grant_access`), and a toolset grant restricts even when it resolves to no servers.

## Behaviour

| Concern           | Rule                                                                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity          | `teamId` (else a deterministic physical name for a create). `team_alias` is **not unique**, so it cannot find a team. A different declared id is a `replace`, create-first, the old team retained. |
| Adopt             | A live team with that id and no state is `Unowned` and needs `--adopt`. A matching one writes nothing.                                                                                             |
| Declared = truth  | `models`, `blocked`, `accessGroupIds`, each object-permission field and the roster are compared and sent **only when declared**. `teamAlias` is always compared.                                   |
| Update            | Partial (`data.json(exclude_unset=True)`, `team_endpoints.py` line 2418): only the team id and what differs. Nothing else about the team is sent.                                                  |
| Object permission | A **merge by top-level field** (`object_permission_utils.py` lines 114-118): a field left out keeps its value, `[]` replaces it. So five fields are managed and the other seven are left alone.    |
| Removal           | `defaultRemovalPolicy: 'retain'`. Opt in with `RemovalPolicy.destroy()`, which **deletes every key of the team** (below).                                                                          |
| Write check       | Reconcile reads back and fails (`LitellmRegistryNotConvergedError` / `…AbsentAfterWriteError`) if a declared field did not land or the team is not there.                                          |

## The roster is additive only

⛔ `/team/member_delete` does not only take a user off the roster: it **deletes every virtual key that user
created for the team** (`team_endpoints.py` lines 3701-3748). A seat's key would vanish with a roster edit. So a
live member the declaration does not list is **never removed and never an error**, and a declared member with
another role is updated through `member_update`.

- Members are added by `userId` only, in **one** `member_add` call. Adding an id that has no user yet creates its
  user row (`add_new_member`), and only PROXY_ADMIN may do that (`_validate_member_user_id_provisioning`).
- ⚠️ `/team/new` adds **the caller as an `admin` member** unless the proxy sets
  `disable_auto_add_proxy_admin_to_teams` (`_should_auto_add_team_creator`, line 1352). That extra member is not
  drift: undeclared members are ignored.
- `role: 'admin'` is **Enterprise** on both routes (`team_endpoints.py` lines 2713-2723 and 3806-3810): a proxy
  without a licence answers 400, the deploy fails with it, and the roster stays as it was.

## Delete deletes the keys

⛔ `/team/delete` is "delete team and associated team keys" (`team_endpoints.py` line 4258, and
`delete_data(team_id_list=…, table_name="key")` at line 4374). It is the most destructive call in this family,
and the reason for `retain`. It is idempotent only after a read that cannot lie: the route's own 404 also covers a
database error (its lookup sits in `except Exception: raise HTTPException(404)`), so success is reported only
when `GET /team/list` no longer has the id. A team still listed re-raises the **original** error.

## Refused before any request

A blank or padded `teamAlias` or `teamId`; a blank, padded or repeated entry in `models`, `accessGroupIds` or any
object-permission list; the sentinel `all-proxy-mcpservers` in `mcpServers` (it grants **every** MCP server, and
only a proxy admin may, `object_permission_utils.py` line 480); a blank tool-permission key; a repeated or blank
`userId`; a role other than `user` or `admin`.

## Licence gating (measured)

`team_endpoints.py` has 19 `premium` references (`grep -ci premium`). The fields this resource **manages** are not
gated except `members[].role: 'admin'`. The gated ones are never sent: the premium metadata fields
(`disable_global_guardrails`, `guardrails`, `policies`, `tags`, `team_member_key_duration`, `prompts`, `logging`,
`secret_manager_settings`, `allowed_passthrough_routes`: a 403 when truthy, `_types.py` lines 4843-4853 and
`common_utils.py` lines 443-468) and `model_max_budget` (a 403, `common_utils.py` lines 73-86).

## Not modelled

Budgets and rate limits (a team's `max_budget` is a HARD cap that 429s every key: the 2026-09-28 incident, see
[litellm-budget.md](./litellm-budget.md)); `metadata`; `router_settings`; `model_aliases`; the organisation; the
Enterprise fields above; and the other `object_permission` fields (vector stores, agents, agent access groups,
`models`, search tools, `mcp_tool_search_enabled`, skills). None is ever sent, so an adopted team keeps them.

## Unmeasured at 1.103.0

No live proxy was contacted. The fake (`fake-team-litellm.ts`) is built from the source; each choice is in its
header. Not exercised: what `/team/info` returns for a team whose `object_permission_id` points at a missing row,
and how the SDK's `{ body: unknown }` typing meets the real answer (the tests pass through the real SDK decode).
`/team/info` declares no 404 in the SDK (create, update and delete do, by distilled patch), so its 404 is read by
class (`registry-support.ts`); the typed fix is a distilled patch, which belongs in the distilled clone and is not
part of this change.
