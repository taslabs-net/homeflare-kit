/**
 * Refusals, wire bodies, the read shape and the comparison for `LiteLLM.MCPServer`, testable
 * without a server.
 *
 * ⛔ FIELDS THAT ARE ACCESS GRANTS ARE ALWAYS COMPARED, WITH A SAFE DEFAULT. `allow_all_keys`
 *   (default false), `allowed_tools` and `mcp_access_groups` (default empty) decide which keys can
 *   reach a server, so an adopted row whose live value differs from the declaration is planned an
 *   update rather than left as it is. Descriptive fields (`alias`, `description`) are compared only
 *   when declared, so adopting a row never clears text a person wrote.
 * ⚠️ EVERY UPDATE SENDS THE FULL MANAGED SET, NOT ONLY THE FIELDS THAT DIFFER. Whether `PUT
 *   /v1/mcp/server` merges the fields it is given or replaces the row is UNMEASURED at 1.103.0
 *   (the request has every field optional except `server_id`, which suggests a merge). Sending the
 *   whole managed set is correct under both; reconcile then reads back and fails loudly if a
 *   declared field did not land (`LitellmMcpServerNotConvergedError`). Fields this resource does
 *   not model are not sent, so a replace-style edit would drop them: measure against a scratch
 *   proxy before the first live update of an adopted OAuth row (docs/litellm-mcp.md).
 */
import type * as mcp from '@distilled.cloud/litellm/mcp_management';
import * as Redacted from 'effect/Redacted';
import {
  AUTH_TYPES,
  type McpServerAttributes,
  type McpServerProps,
  TRANSPORTS,
  isStaticAuthType,
} from './mcp-server-types.ts';

/** A query parameter whose NAME says it carries a secret. */
const SECRET_PARAM = /token|secret|passw|api.?key|auth|credential|signature|^key$|^sig$/i;

const isBlank = (value: unknown): boolean => typeof value !== 'string' || value.trim() === '';

/** Why a URL may not be declared, or `undefined`. ⛔ Never quotes the URL: it may hold the secret. */
const urlProblem = (raw: unknown): string | undefined => {
  if (isBlank(raw)) return '`url` must be a non-empty string';
  let url: URL;
  try {
    url = new URL(raw as string);
  } catch {
    return '`url` must be a full http(s) URL including the scheme';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '`url` must be http or https';
  if (url.username !== '' || url.password !== '') {
    return '`url` must not carry userinfo; declare the credential as `authValue`';
  }
  if (url.hash !== '') return '`url` must not carry a fragment';
  for (const name of url.searchParams.keys()) {
    if (SECRET_PARAM.test(name)) {
      return `\`url\` carries the query parameter "${name}", which looks like a credential; declare it as \`authValue\` instead, because the URL is stored in Alchemy's state`;
    }
  }
  return undefined;
};

const listProblem = (name: string, list: readonly unknown[] | undefined): string | undefined =>
  list !== undefined && list.some((entry) => isBlank(entry))
    ? `\`${name}\` must hold non-empty strings`
    : undefined;

/** The first reason a declaration is refused, or `undefined`. Pure: no environment, no server. */
export const firstProblem = (props: McpServerProps): string | undefined => {
  if (isBlank(props.serverName) || props.serverName !== props.serverName.trim()) {
    return '`serverName` must be a non-empty string without leading or trailing whitespace';
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
 * `userinfo` and secret-looking query values replaced with `REDACTED`, so a live URL that carries a
 * token never reaches Alchemy's unencrypted state.
 * ★ A URL THAT NEEDS NO REDACTION COMES BACK BYTE-FOR-BYTE, never re-serialised: `URL#toString`
 *   adds a trailing slash to a bare origin, and a declared `https://host` would then differ from
 *   its own live row on every plan. A URL that does not parse is returned as it is.
 */
export const redactUrl = (raw: string): string => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  let changed = false;
  if (url.username !== '') {
    url.username = 'REDACTED';
    changed = true;
  }
  if (url.password !== '') {
    url.password = 'REDACTED';
    changed = true;
  }
  // ⚠️ A Set first: `set` mutates the live iterator's list, and a repeated name would be skipped.
  for (const name of new Set(url.searchParams.keys())) {
    if (!SECRET_PARAM.test(name)) continue;
    url.searchParams.set(name, 'REDACTED');
    changed = true;
  }
  return changed ? url.toString() : raw;
};

/**
 * One row of `GET /v1/mcp/server` as attributes.
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
  if (!sameSet(live.allowedTools, props.allowedTools ?? [])) out.push('allowed_tools');
  if (!sameSet(live.mcpAccessGroups, props.mcpAccessGroups ?? [])) out.push('mcp_access_groups');
  if (props.alias !== undefined && live.alias !== props.alias) out.push('alias');
  if (props.description !== undefined && live.description !== props.description) {
    out.push('description');
  }
  return out;
};

/** The managed set both writes send. ⚠️ See the file header on why an update sends all of it. */
const managed = (props: McpServerProps) => ({
  ...(props.alias === undefined ? {} : { alias: props.alias }),
  allow_all_keys: props.allowAllKeys ?? false,
  allowed_tools: [...(props.allowedTools ?? [])],
  auth_type: props.authType,
  ...(props.description === undefined ? {} : { description: props.description }),
  mcp_access_groups: [...(props.mcpAccessGroups ?? [])],
  server_name: props.serverName,
  transport: props.transport,
  url: props.url,
});

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
): mcp.EditMcpServerV1McpServerPutRequest => ({
  ...managed(props),
  ...(clearCredentials ? { credentials: null } : credentialsOf(credential)),
  server_id: serverId,
});
