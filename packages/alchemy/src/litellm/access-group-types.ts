/**
 * What a `LiteLLM.AccessGroup` declares (props) and what is remembered about it (attributes).
 *
 * ★ THIS IS THE UNIFIED ACCESS GROUP, `LiteLLM_AccessGroupTable` (`/v1/unified_access_group`), not
 *   the two other things LiteLLM calls an "access group": a MODEL access group (`access_groups` in a
 *   model's `model_info`) and an MCP access group (a bare name on an MCP server row, referenced by
 *   `object_permission.mcp_access_groups`). A unified group bundles models, MCP servers and agents
 *   under one name and attaches to teams and keys (docs.litellm.ai/docs/proxy/access_groups).
 * ⚠️ TOOLSETS ARE NOT IN IT. `AccessGroupCreateRequest` (`litellm/types/access_group.py`, 1.103.0)
 *   has `access_model_names`, `access_mcp_server_ids`, `access_agent_ids`, `assigned_team_ids` and
 *   `assigned_key_ids` and no toolset field. A toolset is granted through `object_permission.mcp_toolsets`
 *   on a team or key (`LiteLLM.Team`), not through a group.
 * ★ MODELS ARE MODEL NAMES, MCP SERVERS ARE SERVER IDS. `access_model_names` holds the `model_name`
 *   a caller sends (`cf-code`), and `access_mcp_server_ids` holds `server_id`s. Declare a server's id
 *   with `server.serverId` (a `LiteLLM.MCPServer`) so the dependency edge exists.
 * ⚠️ NOT MODELLED, on purpose: `assigned_team_ids`, `assigned_key_ids` and `access_agent_ids`. A
 *   team's group membership is declared on the TEAM (`accessGroupIds`), and LiteLLM mirrors it into
 *   `assigned_team_ids` in the same transaction; two resources writing one edge would fight. Agents
 *   are not managed here. None of the three is ever sent, and the update is a partial one, so an
 *   adopted group keeps whatever it has there.
 */
export interface AccessGroupProps {
  /**
   * The group's name, and the way an existing row is ADOPTED: `access_group_name` is UNIQUE in the
   * table (`access_group_endpoints.py` finds it with `find_unique`), so the match is exact. Changing
   * it is an update of the same row, never a replace: the id does not change.
   */
  readonly accessGroupName: string;
  /** Compared only when declared: adopting a row never clears text a person wrote. Blank is refused. */
  readonly description?: string;
  /**
   * `model_name`s the group grants, compared as a SET and ALWAYS compared (default `[]`): it is an
   * access grant, so an adopted group that grants more than declared is corrected, never left open.
   * ⚠️ LiteLLM prunes a name itself when its last deployment is deleted
   * (`management_helpers/access_group_model_sync.py`), so a plan can show an update for a model that
   * was removed elsewhere.
   */
  readonly modelNames?: readonly string[];
  /** MCP `server_id`s the group grants, compared as a set and always compared (default `[]`). */
  readonly mcpServerIds?: readonly string[];
}

export interface AccessGroupAttributes {
  readonly accessGroupId: string;
  readonly accessGroupName: string;
  readonly description: string | null;
  readonly modelNames: readonly string[];
  readonly mcpServerIds: readonly string[];
}
