/**
 * What a `LiteLLM.Toolset` declares (props) and what is remembered about it (attributes).
 *
 * ★ A TOOLSET IS A NAMED SELECTION OF `{ server_id, tool_name }` PAIRS drawn from one or more MCP
 *   servers (`LiteLLM_MCPToolsetTable`, `/v1/mcp/toolset`; docs.litellm.ai/docs/mcp_toolsets). A key or
 *   team is granted one through `object_permission.mcp_toolsets`, which holds the toolset's ID
 *   (`fetch_mcp_toolsets` filters `list_mcp_toolsets(toolset_ids=…)`), so `LiteLLM.Team` takes
 *   `toolset.toolsetId`, not the name.
 * ⚠️ THE ID IS THE PROXY'S. `create_mcp_toolset` sets `toolset_id = str(uuid.uuid4())` and the create
 *   request has no id field, so nothing here can pick one. The id LiteLLM answers is what is recorded.
 * ★ THE NAME IS A URL SEGMENT. A toolset is served at `/toolset/{toolset_name}/mcp`
 *   (`proxy_server.py` line 19346) and `litellm_proxy/mcp/<toolset_name>` (docs), so a name with a `/`
 *   can never be addressed. LiteLLM itself accepts one; the refusal is this package's.
 * ⚠️ NOT MODELLED: nothing beyond name, description and tools — the table has no other column that a
 *   write reaches.
 */
export interface ToolsetTool {
  /** The MCP server's `server_id`. Declare it as `server.serverId` (a `LiteLLM.MCPServer`). */
  readonly serverId: string;
  /** The tool's name on that server, as the server lists it. */
  readonly toolName: string;
}

export interface ToolsetProps {
  /**
   * The toolset's name, and the way an existing row is ADOPTED. `toolset_name` is unique in the table
   * (a create or rename onto a taken name is a 409), so the match is exact. Changing it is an update of
   * the same row, never a replace.
   */
  readonly toolsetName: string;
  /** Compared only when declared: adopting a row never clears text a person wrote. Blank is refused. */
  readonly description?: string;
  /**
   * The selection, compared as a SET of pairs and ALWAYS compared: it is what a caller may reach, so an
   * adopted toolset with more than declared is corrected. `[]` is an explicit empty selection (LiteLLM
   * keeps an empty list only when it is sent as one). Required, so the declaration always says.
   */
  readonly tools: readonly ToolsetTool[];
}

export interface ToolsetAttributes {
  readonly toolsetId: string;
  readonly toolsetName: string;
  readonly description: string | null;
  /** Sorted by server, then tool, so two reads of one row are equal. */
  readonly tools: readonly ToolsetTool[];
}
