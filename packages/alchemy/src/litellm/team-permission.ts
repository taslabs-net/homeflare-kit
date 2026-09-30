/**
 * The `object_permission` half of `LiteLLM.Team`: reading it, comparing it, and the body that writes it.
 *
 * ★ THE WRITE IS A MERGE BY TOP-LEVEL FIELD (measured, `object_permission_utils.py` lines 114-118,
 *   1.103.0, read from the live container): `prepare_object_permission_upsert` builds
 *   `{**existing_fields, **new_object_permission}`, so a field the request leaves out KEEPS its stored
 *   value, and a field sent as `[]` (or `{}`) REPLACES it with an empty one. That is what lets this
 *   resource manage five fields and leave the other seven of an adopted team alone. docs.litellm.ai/docs/
 *   mcp_grant_access says the same: "unset fields are left unchanged on update".
 * ★ NULL AND `[]` ARE THE SAME "NOTHING GRANTED". A team that never had a grant reads `null` or `[]`
 *   (`LiteLLM_ObjectPermissionTable` defaults), so both normalise to an empty list before comparing.
 * ⚠️ `mcp_tool_permissions` CAN COME BACK AS A JSON STRING (it is stored through `safe_dumps` "for
 *   GraphQL compatibility", and `_resolve_team_allowed_mcp_servers` itself handles both), so the read
 *   accepts an object or a string.
 * ⚠️ THE SERVER REFUSES, AND THIS FILE DOES NOT REPEAT IT: a name or alias that matches several MCP
 *   servers cannot key `mcp_tool_permissions` (400, `reject_ambiguous_mcp_tool_permission_keys`), and a
 *   non-admin caller cannot grant `all-proxy-mcpservers` (403). The one refusal made here is that
 *   sentinel, because it silently grants every server on the proxy and is not something a declaration
 *   should carry by accident.
 */
import type * as team from '@distilled.cloud/litellm/team_management';
import {
  asRow,
  canonical,
  firstBadEntry,
  firstDuplicate,
  isBlank,
  sameSet,
  stringsOf,
} from './registry-support.ts';
import type { TeamObjectPermission, TeamObjectPermissionAttributes } from './team-types.ts';

/** The grant that reaches every MCP server on the proxy (`SpecialMCPServerName.all_proxy_servers`). */
const ALL_PROXY_SERVERS = 'all-proxy-mcpservers';

const LISTS = [
  ['mcpServers', 'mcp_servers'],
  ['mcpAccessGroups', 'mcp_access_groups'],
  ['mcpToolsets', 'mcp_toolsets'],
  ['blockedTools', 'blocked_tools'],
] as const;

const parseToolPermissions = (value: unknown): Readonly<Record<string, readonly string[]>> => {
  const parsed: unknown = typeof value === 'string' ? safeJson(value) : value;
  const row = asRow(parsed);
  if (row === undefined) return {};
  return Object.fromEntries(
    Object.keys(row)
      .sort()
      .map((server) => [server, canonical(stringsOf(row[server]))]),
  );
};

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** A live `object_permission` (or `null`) as this resource compares it. */
export const toPermissionAttributes = (value: unknown): TeamObjectPermissionAttributes => {
  const row = asRow(value);
  return {
    blockedTools: canonical(stringsOf(row?.['blocked_tools'])),
    mcpAccessGroups: canonical(stringsOf(row?.['mcp_access_groups'])),
    mcpServers: canonical(stringsOf(row?.['mcp_servers'])),
    mcpToolPermissions: parseToolPermissions(row?.['mcp_tool_permissions']),
    mcpToolsets: canonical(stringsOf(row?.['mcp_toolsets'])),
  };
};

const sameToolPermissions = (
  live: Readonly<Record<string, readonly string[]>>,
  declared: Readonly<Record<string, readonly string[]>>,
): boolean => {
  const servers = Object.keys(declared).sort();
  return (
    sameSet(Object.keys(live), servers) &&
    servers.every((server) => sameSet(live[server] ?? [], declared[server] ?? []))
  );
};

/** Wire names of the DECLARED fields where live and declared disagree. An undeclared field never counts. */
export const permissionDiffers = (
  live: TeamObjectPermissionAttributes,
  declared: TeamObjectPermission | undefined,
): readonly string[] => {
  if (declared === undefined) return [];
  const fields: string[] = [];
  for (const [prop, wire] of LISTS) {
    const wanted = declared[prop];
    if (wanted !== undefined && !sameSet(live[prop], wanted)) fields.push(wire);
  }
  if (
    declared.mcpToolPermissions !== undefined &&
    !sameToolPermissions(live.mcpToolPermissions, declared.mcpToolPermissions)
  ) {
    fields.push('mcp_tool_permissions');
  }
  return fields;
};

/**
 * The `object_permission` body: the declared fields named in `only` (all of them when `only` is
 * absent, for a create). ⛔ Never a `null`: a merge would read it as "clear", and the declaration said
 * a list.
 */
export const permissionBody = (
  declared: TeamObjectPermission,
  only?: ReadonlySet<string>,
): team.LiteLLMObjectPermissionBase => {
  const body: Record<string, unknown> = {};
  for (const [prop, wire] of LISTS) {
    const wanted = declared[prop];
    if (wanted !== undefined && (only === undefined || only.has(wire))) body[wire] = [...wanted];
  }
  if (
    declared.mcpToolPermissions !== undefined &&
    (only === undefined || only.has('mcp_tool_permissions'))
  ) {
    body['mcp_tool_permissions'] = Object.fromEntries(
      Object.entries(declared.mcpToolPermissions).map(([server, tools]) => [server, [...tools]]),
    );
  }
  return body as team.LiteLLMObjectPermissionBase;
};

/** The first reason a declared object permission is refused, or `undefined`. */
export const permissionProblem = (
  declared: TeamObjectPermission | undefined,
): string | undefined => {
  if (declared === undefined) return undefined;
  for (const [prop] of LISTS) {
    const values = declared[prop] ?? [];
    const bad = firstBadEntry(values);
    if (bad !== undefined)
      return `\`objectPermission.${prop}\` has a blank or padded entry (${JSON.stringify(bad)})`;
    const twice = firstDuplicate(values);
    if (twice !== undefined)
      return `\`objectPermission.${prop}\` lists ${JSON.stringify(twice)} twice`;
  }
  if ((declared.mcpServers ?? []).includes(ALL_PROXY_SERVERS)) {
    return `\`objectPermission.mcpServers\` carries \`${ALL_PROXY_SERVERS}\`, which grants EVERY MCP server on the proxy; list the servers instead`;
  }
  for (const [server, tools] of Object.entries(declared.mcpToolPermissions ?? {})) {
    if (isBlank(server) || server !== server.trim()) {
      return '`objectPermission.mcpToolPermissions` has a blank or padded server key';
    }
    const bad = firstBadEntry(tools);
    if (bad !== undefined)
      return `\`objectPermission.mcpToolPermissions\` lists a blank or padded tool for ${server}`;
    const twice = firstDuplicate(tools);
    if (twice !== undefined)
      return `\`objectPermission.mcpToolPermissions\` lists ${JSON.stringify(twice)} twice for ${server}`;
  }
  return undefined;
};
