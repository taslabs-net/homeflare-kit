/**
 * `Cloudflare.McpServer` — its props, its attributes, and the pure `diff` that decides between
 * update and replace.
 *
 * ⛔ THE ATTRIBUTES NEVER HOLD A CREDENTIAL. `auth_credentials` and `client_secret` are write-only
 *   at the API (the read endpoints return an `auth_config_summary` that never includes the secret
 *   value), and Alchemy's state store is not encrypted — `StateEncoding.ts` TAGS a `Redacted`
 *   value and writes the inner value beside the tag, so `Redacted` hides a secret from a log line
 *   and from nothing else. So both are declared as `{ fromEnv: 'NAME' }` (secrets/write-only.ts),
 *   the NAME lands in state, and the value exists only in the deploying process and on the wire.
 * ★ AND A PLAN STILL NOTICES A CHANGE, because what was last written is remembered as a salted
 *   scrypt SEAL, the same mechanism the PBS notification targets use.
 */
import type { Diff } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import type { FromEnv } from '../secrets/write-only.ts';
import {
  type McpCapabilityOverride,
  type McpServerAuthType,
  type McpServerAuthenticationStatus,
  McpServerError,
  type McpServerStatus,
} from './mcp-server-api.ts';

export interface McpServerProps {
  /**
   * The entry's id in the account — client-supplied, required, and the identity everything else
   * names. ⛔ Changing it REPLACES the entry, because the id is what the governing Access
   * application's `{ type: 'via_mcp_server_portal', mcpServerId }` destination points at.
   * ★ Required rather than generated: a generated id would have to be read back out of state
   *   before that application could be declared, which is the opposite of a declaration.
   */
  readonly serverId: string;
  /** Display name in the portal. Defaults to the id. */
  readonly name?: string;
  /**
   * The FULL upstream MCP endpoint URL, including its path — `https://example.com/mcp`, not
   * `example.com`. ⚠️ THE FIELD IS NAMED `hostname` AND IS NOT ONE; Cloudflare's own API doc
   * calls it "URL of the upstream MCP endpoint". A bare host is refused by `validateMcpServer`
   * rather than sent, because the portal would then fetch `https:///` and report a sync error
   * that reads like the upstream server being down.
   * ⛔ CREATE-ONLY: the update request has no `hostname`, so a change is a replace.
   * ⚠️ The upstream hostname must be PROXIED in Cloudflare DNS for a portal to reach it
   *   (developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/).
   */
  readonly hostname: string;
  /**
   * How the portal authenticates to the upstream server.
   * ⛔ CREATE-ONLY, like `hostname`, and required for that reason — a default would silently fix
   *   a choice that can only be changed by replacing the entry.
   * - `oauth` — the upstream server is its own OAuth resource (including one fronted by
   *   Cloudflare Access managed OAuth). The portal registers itself; no static secret here.
   * - `bearer` — a static credential, declared as `authCredentials`.
   * - `unauthenticated` — no credential at all.
   */
  readonly authType: McpServerAuthType;
  /**
   * The static credential for `authType: 'bearer'`, by the NAME of the environment variable
   * holding it. Either a raw token, or a JSON object `{"headers":{…}}` for custom headers — which
   * is how an Access service token pair (`cf-access-client-id` / `cf-access-client-secret`) is
   * sent, per Cloudflare's own example.
   */
  readonly authCredentials?: FromEnv;
  /** The pre-registered OAuth client secret for a manual-mode `oauth` entry, by variable name. */
  readonly clientSecret?: FromEnv;
  readonly description?: string;
  /**
   * Use Cloudflare's shared OAuth callback instead of the portal hostname's. Server default off.
   */
  readonly isSharedOauthCallbackEnabled?: boolean;
  /** Route the portal's outbound traffic to this server through the Secure Web Gateway. */
  readonly secureWebGateway?: boolean;
  /** Server-wide tool overrides — rename, re-describe or disable an upstream tool. */
  readonly updatedTools?: readonly McpCapabilityOverride[];
  /** Server-wide prompt overrides. */
  readonly updatedPrompts?: readonly McpCapabilityOverride[];
  /**
   * Re-run the catalog sync on every reconcile, not only after the create.
   * ⚠️ A sync is a WRITE that talks to the upstream server; leaving this off keeps a no-op deploy
   *   from waking it. Turn it on for a server whose tool list changes with its own releases.
   */
  readonly resync?: boolean;
}

export interface McpServerAttributes {
  readonly serverId: string;
  /** The account the provider environment resolved when the entry was written. */
  readonly accountId: string;
  readonly name: string;
  readonly hostname: string;
  readonly authType: McpServerAuthType;
  readonly description: string | undefined;
  readonly isSharedOauthCallbackEnabled: boolean;
  readonly secureWebGateway: boolean;
  /** Catalog sync state as of the last read or write. It moves on its own. */
  readonly status: McpServerStatus | undefined;
  /** `required` means an administrator must still finish the upstream OAuth flow by hand. */
  readonly authenticationStatus: McpServerAuthenticationStatus | undefined;
  readonly lastSynced: string | undefined;
  readonly createdAt: string | undefined;
  /** `scrypt:<salt>:<digest>` of the credential last written, or `''`. ⛔ Never the value. */
  readonly authCredentialsSeal: string;
  /** `scrypt:<salt>:<digest>` of the client secret last written, or `''`. ⛔ Never the value. */
  readonly clientSecretSeal: string;
}

const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const idProblem = (serverId: unknown): string | undefined => {
  if (typeof serverId !== 'string' || serverId.length === 0) return 'must be a non-empty string';
  if (serverId !== serverId.trim()) return 'has leading or trailing whitespace';
  if (!ID_SHAPE.test(serverId)) {
    return 'must be 1-64 characters of letters, digits, dot, dash or underscore, starting with a letter or digit';
  }
  return undefined;
};

/**
 * ⛔ THE ONE REFUSAL THAT PAYS FOR ITSELF: a bare host in `hostname`. The field's NAME invites it,
 *   the API accepts it, and the portal then has no endpoint to call.
 */
const hostnameProblem = (hostname: unknown): string | undefined => {
  if (typeof hostname !== 'string' || hostname.length === 0) return 'must be a non-empty string';
  let url: URL;
  try {
    url = new URL(hostname);
  } catch {
    return `must be a full URL including the scheme and path, e.g. "https://${hostname}/mcp" — the field is named \`hostname\` but Cloudflare documents it as "URL of the upstream MCP endpoint"`;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return `must be an http(s) URL; "${url.protocol}" is not one the portal can fetch`;
  }
  if (url.hash !== '') return 'must not carry a fragment; the portal sends the URL as given';
  return undefined;
};

/** Which credential props each auth type may carry. ⛔ Fail closed on a combination nobody meant. */
const credentialProblem = (props: McpServerProps): string | undefined => {
  const hasCredentials = props.authCredentials !== undefined;
  const hasSecret = props.clientSecret !== undefined;
  if (props.authType === 'bearer') {
    if (!hasCredentials) return '`authType: "bearer"` needs `authCredentials: { fromEnv: … }`';
    if (hasSecret) return '`clientSecret` belongs to a manual-mode `oauth` entry, not to `bearer`';
    return undefined;
  }
  if (hasCredentials) {
    return `\`authCredentials\` is the static credential for \`authType: "bearer"\`; this entry is "${props.authType}"`;
  }
  if (props.authType === 'unauthenticated' && hasSecret) {
    return '`clientSecret` belongs to a manual-mode `oauth` entry, not to `unauthenticated`';
  }
  return undefined;
};

/** ⛔ Fail closed on a declaration the API would accept but nobody meant. */
export const validateMcpServer = (props: McpServerProps): McpServerError | undefined => {
  const id = idProblem(props.serverId);
  if (id !== undefined) return new McpServerError({ message: `McpServer \`serverId\` ${id}.` });
  const host = hostnameProblem(props.hostname);
  if (host !== undefined) {
    return new McpServerError({
      message: `McpServer "${props.serverId}" \`hostname\` ${host}.`,
    });
  }
  if (
    props.authType !== 'oauth' &&
    props.authType !== 'bearer' &&
    props.authType !== 'unauthenticated'
  ) {
    return new McpServerError({
      message: `McpServer "${props.serverId}" \`authType\` must be "oauth", "bearer" or "unauthenticated". It is create-only, so it has no default.`,
    });
  }
  const credential = credentialProblem(props);
  return credential === undefined
    ? undefined
    : new McpServerError({ message: `McpServer "${props.serverId}": ${credential}.` });
};

/**
 * update or replace, from the declaration and what was last written.
 *
 * - Account changed → `replace`, create-first: ids are unique per ACCOUNT, so nothing collides.
 * - `serverId` changed → `replace`, create-first: the new entry's id is free by definition.
 * - `hostname` or `authType` changed → `replace`, and ⛔ `deleteFirst` when the id stays the
 *   same, because the new generation must create the SAME id the old one still holds. Create-first
 *   there would answer "already exists" — or, worse, a create path that "converged" on the live
 *   entry would record a hostname it does not have.
 * - Otherwise → no opinion; the engine compares props.
 *
 * ⚠️ A deleteFirst replace means the entry is briefly absent from the portal, and the Access
 *   application that names `mcpServerId` keeps pointing at an id that exists again a moment later.
 *   That is the only order the API allows for a create-only field on a client-supplied id.
 */
export const diffMcpServer = (
  news: Input<McpServerProps>,
  output: McpServerAttributes | undefined,
  accountId: string,
): Diff | undefined => {
  if (output === undefined) return undefined;
  if (output.accountId !== accountId) return { action: 'replace' };
  const fields = news as {
    readonly serverId?: unknown;
    readonly hostname?: unknown;
    readonly authType?: unknown;
  };
  const serverId = typeof fields.serverId === 'string' ? fields.serverId : undefined;
  if (serverId !== undefined && serverId !== output.serverId) return { action: 'replace' };
  const hostname = typeof fields.hostname === 'string' ? fields.hostname : undefined;
  const authType = typeof fields.authType === 'string' ? fields.authType : undefined;
  const createOnlyMoved =
    (hostname !== undefined && hostname !== output.hostname) ||
    (authType !== undefined && authType !== output.authType);
  if (!createOnlyMoved) return undefined;
  // ★ An unresolved `serverId` counts as unchanged, which picks the order that cannot collide.
  return serverId === undefined || serverId === output.serverId
    ? { action: 'replace', deleteFirst: true }
    : { action: 'replace' };
};
