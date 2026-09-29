/**
 * Refusals, wire bodies, the read shape and the comparison for `LiteLLM.MCPServer`, testable
 * without a server. The URL rules are in `mcp-server-url.ts`.
 *
 * ⛔ TWO ACCESS GRANTS ARE ALWAYS COMPARED, WITH A CLOSED DEFAULT. `allow_all_keys` (default
 *   false) and `mcp_access_groups` (default empty) decide which keys can reach a server, so a live
 *   value that differs from the declaration is corrected rather than left as it is.
 * ⛔ `allowed_tools` IS NOT ONE OF THEM: it is compared and sent ONLY WHEN DECLARED, like `alias`.
 *   An empty list is the OPEN state, not a closed one. Measured on the live 1.103.0 container:
 *   `server_applies_tool_allowlist` (`mcp_server/utils.py`) is "the `mcp_info` enforce flag, or a
 *   non-empty `allowed_tools`", and `filter_tools_by_allowed_tools` (`server.py` lines 1692-1698)
 *   returns every tool when it is false. This resource does not model `mcp_info`, so a default of
 *   `[]` would switch a live whitelist OFF the moment a row is adopted without restating it, and an
 *   adopted row is planned `adopted` (Alchemy's adoption branch), so no `update` would show. An
 *   undeclared list is left exactly as the proxy holds it.
 * ★ Descriptive fields (`alias`, `description`) are also compared only when declared, so adopting a
 *   row never clears text a person wrote. That holds on the wire too, for `alias` only because an
 *   update RE-SENDS the live alias whenever it sends a `serverName` (`identityOnUpdate` below).
 * ⚠️ EVERY UPDATE SENDS THE FULL MANAGED SET, NOT ONLY THE FIELDS THAT DIFFER, bar the two name
 *   fields, which `identityOnUpdate` sends selectively because LiteLLM defaults an alias. The edit
 *   route is a PARTIAL update at 1.103.0 (measured by reading the live container's
 *   `mcp_server/db.py`, the update function's `exclude_unset=True`: fields the caller did not send
 *   keep their stored value; no live call was made), so a field this resource does not send is left
 *   alone. Sending the whole managed set is still correct, and reconcile reads back and fails loudly
 *   if a declared field did not land (`LitellmMcpServerNotConvergedError`). Whether a `false` or an
 *   empty list is written rather than skipped stays UNMEASURED, which is what the read back guards.
 */
import type * as mcp from '@distilled.cloud/litellm/mcp_management';
import * as Redacted from 'effect/Redacted';
import { redactUrl, urlProblem } from './mcp-server-url.ts';
import {
  AUTH_TYPES,
  type McpServerAttributes,
  type McpServerProps,
  TRANSPORTS,
  isBlank,
  isStaticAuthType,
} from './mcp-server-types.ts';

const listProblem = (name: string, list: readonly unknown[] | undefined): string | undefined =>
  list !== undefined && list.some((entry) => isBlank(entry))
    ? `\`${name}\` must hold non-empty strings`
    : undefined;

/**
 * ⛔ LITELLM 1.103 RUNS THE MCP SDK'S `validate_tool_name` ON `server_name` AND THE NORMALISED
 *   ALIAS, and that 400 happens only at apply. The names it accepts are `^[A-Za-z0-9._]{1,128}$`:
 *   a space, `/`, `:`, `@`, or more than 128 characters is refused here so nothing is written to
 *   Alchemy's state first. `-` is out for the same reason and one more: it is
 *   `MCP_TOOL_PREFIX_SEPARATOR` (default `-`, unset in the live container as measured 2026-09-29),
 *   and a tool is `<alias>-<tool>`. A proxy that set another separator would be over-refused:
 *   rare, and loud. `normalize_server_name` would also rewrite a space to `_`, so a name outside
 *   this pattern would never equal the row it produced.
 */
const TOOL_NAME = /^[A-Za-z0-9._]{1,128}$/;

const toolNameProblem = (field: string, value: string): string | undefined =>
  TOOL_NAME.test(value)
    ? undefined
    : `\`${field}\` must match ^[A-Za-z0-9._]{1,128}$: LiteLLM 1.103 rejects a space, "/", ":", "@", "-" or more than 128 characters only at apply`;

/** A declared alias is a tool name too. Omitted is fine: the live alias is kept. */
const aliasProblem = (alias: string | undefined): string | undefined => {
  if (alias === undefined) return undefined;
  if (isBlank(alias)) return '`alias` must be a non-empty string when declared';
  return toolNameProblem('alias', alias);
};

/** The first reason a declaration is refused, or `undefined`. Pure: no environment, no server. */
export const firstProblem = (props: McpServerProps): string | undefined => {
  if (isBlank(props.serverName) || props.serverName !== props.serverName.trim()) {
    return '`serverName` must be a non-empty string without leading or trailing whitespace';
  }
  const named = toolNameProblem('serverName', props.serverName) ?? aliasProblem(props.alias);
  if (named !== undefined) return named;
  // ⛔ A blank description never converges. LiteLLM copies the column into `mcp_info` only when
  //   the value is truthy (`build_mcp_server_from_table`), and the list then answers
  //   `mcp_info.description`. `''` is written and read back as absent, so every deploy would fail
  //   the read back. Omitted is still "leave the live text alone".
  if (props.description !== undefined && isBlank(props.description)) {
    return '`description` must be a non-empty string when declared: LiteLLM copies it into mcp_info only when it is truthy, so a blank one never converges';
  }
  if (props.serverId !== undefined && isBlank(props.serverId)) {
    return '`serverId` must be a non-empty string when declared';
  }
  const url = urlProblem(props.url);
  if (url !== undefined) return url;
  if (!TRANSPORTS.includes(props.transport)) {
    return '`transport` must be "sse" or "http" (`stdio` runs a command on the proxy host and is not modelled)';
  }
  if (!AUTH_TYPES.includes(props.authType)) {
    return `\`authType\` must be one of ${AUTH_TYPES.join(', ')}; the others need credential fields this resource does not model`;
  }
  const declared = props.authValue !== undefined;
  if (isStaticAuthType(props.authType) && !declared) {
    return `\`authType: "${props.authType}"\` needs \`authValue: { fromEnv: … }\``;
  }
  if (!isStaticAuthType(props.authType) && declared) {
    return `\`authValue\` is the static credential for api_key, bearer_token, basic, authorization and token; this server is "${props.authType}"`;
  }
  if (declared && isBlank(props.authValue?.fromEnv)) {
    return '`authValue.fromEnv` must name an environment variable';
  }
  return (
    listProblem('allowedTools', props.allowedTools) ??
    listProblem('mcpAccessGroups', props.mcpAccessGroups)
  );
};

/**
 * One row of `GET /v1/mcp/server`, or of the by-id read, as attributes.
 *
 * ⚠️ THE LIST'S `description` IS `mcp_info.description` WHEN THAT EXISTS, else the column (measured
 *   on the live 1.103.0 container: `_build_mcp_server_table` and, on registration,
 *   `build_mcp_server_from_table`, which copies the column into `mcp_info` only when `mcp_info`
 *   has none). This resource writes only the column, so a declared description cannot be read back
 *   from a row whose `mcp_info` holds another: reconcile refuses that before it writes.
 *
 * ⛔ `credentials`, `static_headers`, `env`, `env_vars` and every other field are deliberately NOT
 *   copied: what LiteLLM stores as a credential stays on the proxy. The `credentialSeal` is filled
 *   in by the caller from the previous state; a row cannot supply one.
 */
export const toAttributes = (row: mcp.LiteLLMMCPServerTable): McpServerAttributes => ({
  alias: row.alias ?? null,
  allowAllKeys: row.allow_all_keys ?? false,
  allowedTools: [...(row.allowed_tools ?? [])],
  authType: row.auth_type ?? 'none',
  credentialSeal: '',
  description: row.description ?? null,
  mcpAccessGroups: [...(row.mcp_access_groups ?? [])],
  serverId: row.server_id,
  serverName: row.server_name ?? null,
  transport: row.transport,
  url: row.url === undefined || row.url === null ? null : redactUrl(row.url),
});

const sameSet = (live: readonly string[], declared: readonly string[]): boolean =>
  new Set(live).size === new Set(declared).size && declared.every((entry) => live.includes(entry));

/** Wire names of the fields where the live row and the declaration disagree. */
export const differing = (live: McpServerAttributes, props: McpServerProps): readonly string[] => {
  const out: string[] = [];
  if (live.serverName !== props.serverName) out.push('server_name');
  if (live.url !== props.url) out.push('url');
  if (live.transport !== props.transport) out.push('transport');
  if (live.authType !== props.authType) out.push('auth_type');
  if (live.allowAllKeys !== (props.allowAllKeys ?? false)) out.push('allow_all_keys');
  if (props.allowedTools !== undefined && !sameSet(live.allowedTools, props.allowedTools)) {
    out.push('allowed_tools');
  }
  if (!sameSet(live.mcpAccessGroups, props.mcpAccessGroups ?? [])) out.push('mcp_access_groups');
  if (props.alias !== undefined && live.alias !== props.alias) out.push('alias');
  if (props.description !== undefined && live.description !== props.description) {
    out.push('description');
  }
  return out;
};

/** The managed set both writes send, WITHOUT the name fields. ⚠️ See the file header on why an update sends all of it. */
const managed = (props: McpServerProps) => ({
  allow_all_keys: props.allowAllKeys ?? false,
  ...(props.allowedTools === undefined ? {} : { allowed_tools: [...props.allowedTools] }),
  auth_type: props.authType,
  ...(props.description === undefined ? {} : { description: props.description }),
  mcp_access_groups: [...(props.mcpAccessGroups ?? [])],
  transport: props.transport,
  url: props.url,
});

/** A create names the row, and sends an alias only when one is declared: LiteLLM defaults it to the name. */
const identityOnCreate = (props: McpServerProps) => ({
  ...(props.alias === undefined ? {} : { alias: props.alias }),
  server_name: props.serverName,
});

/**
 * ⛔ AN UPDATE MUST NOT LET LITELLM DEFAULT THE ALIAS. Measured 2026-09-29 by running the live
 *   1.103.0 container's own `validate_and_normalize_mcp_server_payload` and `_prepare_mcp_server_data`
 *   on an edit body (no database, no network): a body with a `server_name` and no `alias` comes out
 *   with `alias = normalize(server_name)` and the alias IS WRITTEN, because the route captures the
 *   set of fields the caller sent BEFORE the normalisation and `_prepare_mcp_server_data` drops an
 *   alias only when it is still None. The alias is the tool prefix (`get_server_prefix`), so a row
 *   with alias `search` and name `estate_web` would have every tool renamed `estate_web-*` for
 *   every key and seat, while `differing` (which skips an undeclared alias) called it converged.
 *   A body with neither field sends no alias. So:
 *   - `server_name` is sent only when it CHANGES, and
 *   - an alias is sent when declared, or (on a rename) as the live one, so a rename keeps the prefix.
 *   A live row with no alias that is renamed gets the new name as its alias: LiteLLM's own default.
 */
const identityOnUpdate = (props: McpServerProps, live: McpServerAttributes) => {
  const renamed = live.serverName !== props.serverName;
  const alias = props.alias ?? (renamed && live.alias !== null ? live.alias : undefined);
  return {
    ...(alias === undefined ? {} : { alias }),
    ...(renamed ? { server_name: props.serverName } : {}),
  };
};

/**
 * ⛔ THE ONE PLACE THE CREDENTIAL IS UNWRAPPED, and it goes straight onto the wire body. `undefined`
 *   sends no `credentials` key at all, which leaves whatever LiteLLM already holds.
 */
const credentialsOf = (credential: Redacted.Redacted<string> | undefined) =>
  credential === undefined ? {} : { credentials: { auth_value: Redacted.value(credential) } };

export const createBody = (
  props: McpServerProps,
  serverId: string,
  credential: Redacted.Redacted<string> | undefined,
): mcp.AddMcpServerV1McpServerPostRequest => ({
  ...managed(props),
  ...identityOnCreate(props),
  ...credentialsOf(credential),
  server_id: serverId,
});

/**
 * `clearCredentials` sends an explicit `credentials: null`, for a server moving off a static auth
 * type. Whether LiteLLM clears its stored credential on `null` or ignores it (an `exclude_none`
 * merge) is UNMEASURED at 1.103.0; either way nothing is sent that could set a wrong one.
 */
export const updateBody = (
  props: McpServerProps,
  serverId: string,
  credential: Redacted.Redacted<string> | undefined,
  clearCredentials: boolean,
  live: McpServerAttributes,
): mcp.EditMcpServerV1McpServerPutRequest => ({
  ...managed(props),
  ...identityOnUpdate(props, live),
  ...(clearCredentials ? { credentials: null } : credentialsOf(credential)),
  server_id: serverId,
});
