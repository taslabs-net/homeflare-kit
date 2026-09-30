/**
 * Wire bodies, comparison and refusals for `LiteLLM.Toolset`, testable without a server.
 *
 * ★ THE EDIT IS A PARTIAL ONE (`update_mcp_toolset`, 1.103.0, read from the live container): an absent
 *   field keeps its stored value, a `null` clears it, EXCEPT `toolset_name` and `tools`, where `null`
 *   is a no-op ("a toolset always has a name and a tool list"). So `tools` is sent only as a list, and
 *   emptying a selection is an explicit `[]`. This resource never sends a `null` name or list.
 */
import type * as mcp from '@distilled.cloud/litellm/mcp_management';
import { asRow, firstBadEntry, isBlank, stringOrNull } from './registry-support.ts';
import type { ToolsetAttributes, ToolsetProps, ToolsetTool } from './toolset-types.ts';

const pairKey = (tool: ToolsetTool): string => JSON.stringify([tool.serverId, tool.toolName]);

/** Sorted by server, then tool. A set has no order, so this is the form two reads compare in. */
const canonicalTools = (tools: readonly ToolsetTool[]): readonly ToolsetTool[] =>
  [...new Map(tools.map((tool) => [pairKey(tool), tool])).values()].sort((a, b) =>
    pairKey(a).localeCompare(pairKey(b)),
  );

const sameTools = (left: readonly ToolsetTool[], right: readonly ToolsetTool[]): boolean => {
  const a = canonicalTools(left).map(pairKey);
  const b = canonicalTools(right).map(pairKey);
  return a.length === b.length && a.every((each, index) => each === b[index]);
};

/** The first reason a declaration is refused, or `undefined`. Runs before any request. */
export const firstProblem = (props: ToolsetProps): string | undefined => {
  if (isBlank(props.toolsetName) || props.toolsetName !== props.toolsetName.trim()) {
    return '`toolsetName` must be a non-blank name with no leading or trailing space';
  }
  if (props.toolsetName.includes('/')) {
    return '`toolsetName` contains `/`: a toolset is served at /toolset/{toolset_name}/mcp, so that name can never be addressed';
  }
  if (props.description !== undefined && isBlank(props.description)) {
    return '`description` is blank; leave it out to keep the live text';
  }
  if (!Array.isArray(props.tools)) return '`tools` must be a list (an empty one is `[]`)';
  const bad =
    firstBadEntry(props.tools.map((tool) => tool.serverId)) ??
    firstBadEntry(props.tools.map((tool) => tool.toolName));
  if (bad !== undefined)
    return `a tool has a blank or padded serverId or toolName (${JSON.stringify(bad)})`;
  const keys = props.tools.map(pairKey);
  const twice = keys.find((key, index) => keys.indexOf(key) !== index);
  if (twice !== undefined) return `\`tools\` lists ${twice} twice`;
  return undefined;
};

/** One toolset row. `undefined` is "not a toolset": the caller refuses the whole answer. */
export const toAttributes = (value: unknown): ToolsetAttributes | undefined => {
  const row = asRow(value);
  if (row === undefined) return undefined;
  const toolsetId = row['toolset_id'];
  const toolsetName = row['toolset_name'];
  if (typeof toolsetId !== 'string' || typeof toolsetName !== 'string') return undefined;
  const tools: ToolsetTool[] = [];
  for (const entry of Array.isArray(row['tools']) ? row['tools'] : []) {
    const pair = asRow(entry);
    if (typeof pair?.['server_id'] === 'string' && typeof pair['tool_name'] === 'string') {
      tools.push({ serverId: pair['server_id'], toolName: pair['tool_name'] });
    }
  }
  return {
    description: stringOrNull(row['description']),
    toolsetId,
    toolsetName,
    tools: canonicalTools(tools),
  };
};

/** Wire names of the fields where live and declared disagree. */
export const differing = (live: ToolsetAttributes, props: ToolsetProps): readonly string[] => {
  const fields: string[] = [];
  if (live.toolsetName !== props.toolsetName) fields.push('toolset_name');
  if (props.description !== undefined && live.description !== props.description) {
    fields.push('description');
  }
  if (!sameTools(live.tools, props.tools)) fields.push('tools');
  return fields;
};

const wireTools = (tools: readonly ToolsetTool[]): mcp.MCPToolsetTool[] =>
  tools.map((tool) => ({ server_id: tool.serverId, tool_name: tool.toolName }));

export const createBody = (props: ToolsetProps): mcp.AddMcpToolsetV1McpToolsetPostRequest => ({
  toolset_name: props.toolsetName,
  tools: wireTools(props.tools),
  ...(props.description === undefined ? {} : { description: props.description }),
});

/** Only what differs, and never a `null` name or list (LiteLLM ignores those). */
export const updateBody = (
  props: ToolsetProps,
  live: ToolsetAttributes,
): mcp.EditMcpToolsetV1McpToolsetPutRequest => {
  const changed = new Set(differing(live, props));
  return {
    toolset_id: live.toolsetId,
    ...(changed.has('toolset_name') ? { toolset_name: props.toolsetName } : {}),
    ...(changed.has('description') ? { description: props.description ?? null } : {}),
    ...(changed.has('tools') ? { tools: wireTools(props.tools) } : {}),
  };
};
