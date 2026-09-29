/**
 * What a `LiteLLM.MCPServer` declares (props) and what is remembered about it (attributes).
 *
 * ⛔ NEITHER TYPE HOLDS A CREDENTIAL (S25). Alchemy persists props AND attributes in its state
 *   store, and it does not encrypt them: `StateEncoding.ts` TAGS a `Redacted` value and writes the
 *   inner value beside the tag (measured on alchemy 2.0.0-beta.79, `State/StateEncoding.ts` line
 *   87-89). So a `Redacted<string>` prop would still land in state as plaintext. The credential is
 *   declared as `{ fromEnv: 'NAME' }`; the NAME is what is stored, and the value lives only in the
 *   deploying process (wrapped in `Redacted` there, `mcp-server-credential.ts`) and on the wire.
 * ★ WHAT LITELLM STORES IS NEVER MIRRORED BACK. The list route carries `credentials`,
 *   `static_headers`, `env` and `env_vars`; `toAttributes` (mcp-server-form.ts) copies none of them.
 * ⚠️ NOT MODELLED, on purpose: `stdio` (it runs a command on the proxy host), the OAuth client
 *   registration fields, `static_headers`/`extra_headers`, `mcp_info`, tool renames, BYOK and
 *   the AWS / token-exchange auth types (each needs credential fields this resource does not
 *   model). A row that uses them can still be adopted; what is not declared is left alone.
 * ⚠️ NO `teams`. The create and edit requests of `@distilled.cloud/litellm` 0.3.0 (LiteLLM 1.103.0)
 *   have no team field; `teams` exists only on the row a read returns. Team access is granted on
 *   the team side (its `object_permission`), which is a different resource.
 */
import type { FromEnv } from '../secrets/write-only.ts';

/** `stdio` is refused by the type: it would run a declared command on the proxy host. */
export type McpTransport = 'sse' | 'http';

/**
 * Auth types that carry ONE static credential (`credentials.auth_value` on the wire). Which header
 * each one becomes is LiteLLM's, not this package's (unmeasured here).
 */
export type McpStaticAuthType = 'api_key' | 'bearer_token' | 'basic' | 'authorization' | 'token';

/** `oauth2` is a per-user flow LiteLLM runs itself: no static credential is declared for it. */
export type McpAuthType = 'none' | 'oauth2' | McpStaticAuthType;

export interface McpServerProps {
  /**
   * The server's name, and the way an existing row is ADOPTED: the live row whose `server_name`
   * equals it. Changing it is an update of the same row, never a replace. The update re-sends the
   * live alias, so the tool prefix stays. Declare `alias` to change the prefix.
   */
  readonly serverName: string;
  /**
   * Pins the live row (adopts by id) or chooses the id a create asks for. Without it, a live row
   * is found by `serverName` and a new one gets a deterministic physical name. ⛔ A DIFFERENT
   * DECLARED ID IS A REPLACE (create-first, so the old row is only removed by an opt-in
   * `RemovalPolicy.destroy()`).
   */
  readonly serverId?: string;
  /**
   * The tool prefix LiteLLM shows (`<alias>-<tool>`). Compared only when declared, and an
   * undeclared live alias is KEPT: an update that sends a `serverName` with no alias would make
   * LiteLLM rewrite the alias to the name, so the live one is re-sent (mcp-server-form.ts).
   * Declare this to change the prefix; a changed `serverName` does not. ⛔ Must match
   * `^[A-Za-z0-9._]{1,128}$` (same rule as `serverName`): LiteLLM 1.103 runs `validate_tool_name`
   * on it, so a space, `/`, `:`, `@` or more than 128 characters is a 400 only at apply.
   */
  readonly alias?: string;
  /**
   * The upstream MCP endpoint, `http` or `https`. ⛔ Refused if it carries userinfo, a fragment or
   * a secret-looking query parameter (`?token=…`): the URL is a prop, so it lands in state. Declare
   * the credential as `authValue` instead.
   */
  readonly url: string;
  /** `sse` or `http`. Required: LiteLLM's own default is not this resource's to fix silently. */
  readonly transport: McpTransport;
  /** Required: a default would silently choose "no authentication". */
  readonly authType: McpAuthType;
  /**
   * The static credential for a `McpStaticAuthType`, by the NAME of the environment variable that
   * holds it. Required for those types and refused for the others.
   */
  readonly authValue?: FromEnv;
  /**
   * Compared only when declared. ⚠️ A blank one (`''` or whitespace) is refused: LiteLLM copies the
   * column into `mcp_info` only when the value is truthy, so it would never converge. LiteLLM's
   * list answers `mcp_info.description` in preference to this column, and this resource writes only
   * the column. A row whose `mcp_info` has a `description` key (even a null one) that differs from
   * the declaration is refused (`LitellmMcpServerDescriptionShadowedError`) rather than written and
   * failed on the read back.
   */
  readonly description?: string;
  /**
   * Whether EVERY virtual key may call this server. Always compared, default `false`: it is an
   * access grant, so an adopted row that has it on is corrected, never left open silently.
   */
  readonly allowAllKeys?: boolean;
  /**
   * The tools a caller may use, compared as a set. ⛔ COMPARED AND SENT ONLY WHEN DECLARED: omitted
   * leaves the live whitelist exactly as it is. ⚠️ `[]` is NOT "closed" — at 1.103.0 an empty list
   * turns the whitelist off (every tool is returned) unless the row's `mcp_info` carries the enforce
   * flag, which this resource does not model. Declare `[]` only to mean "no restriction".
   */
  readonly allowedTools?: readonly string[];
  /** Access groups this server belongs to. Always compared (as a set). */
  readonly mcpAccessGroups?: readonly string[];
}

export interface McpServerAttributes {
  readonly serverId: string;
  readonly serverName: string | null;
  readonly alias: string | null;
  /** ⛔ REDACTED on the way in (userinfo and secret-looking query values become `REDACTED`). */
  readonly url: string | null;
  readonly transport: string;
  /** `none` when the live row carries no auth type. */
  readonly authType: string;
  readonly description: string | null;
  readonly allowAllKeys: boolean;
  readonly allowedTools: readonly string[];
  readonly mcpAccessGroups: readonly string[];
  /**
   * `scrypt:<salt>:<digest>` of the credential last written, or `''`. ⛔ Never the value. LiteLLM
   * does not return a credential to compare with, so this is how a plan notices a rotated one
   * (secrets/write-only.ts). It is carried from the previous state, never read from the row.
   */
  readonly credentialSeal: string;
}

/** Whether a value is not a string with something in it. Takes `unknown`: a declaration can say anything. */
export const isBlank = (value: unknown): boolean =>
  typeof value !== 'string' || value.trim() === '';

const STATIC: ReadonlySet<string> = new Set<McpStaticAuthType>([
  'api_key',
  'bearer_token',
  'basic',
  'authorization',
  'token',
]);

/** Whether an auth type carries one static credential. Takes a string: a live row can say anything. */
export const isStaticAuthType = (authType: string): boolean => STATIC.has(authType);

export const AUTH_TYPES: readonly McpAuthType[] = [
  'none',
  'oauth2',
  'api_key',
  'bearer_token',
  'basic',
  'authorization',
  'token',
];

export const TRANSPORTS: readonly McpTransport[] = ['sse', 'http'];
