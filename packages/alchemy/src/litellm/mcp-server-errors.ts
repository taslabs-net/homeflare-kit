/**
 * The typed refusals `LiteLLM.MCPServer` raises on top of `@distilled.cloud/litellm`'s own SDK errors.
 *
 * ⛔ NO MESSAGE HERE MAY CARRY A CREDENTIAL. The only things named are the server's name, ids the
 *   proxy already lists, field names, and the NAME of an environment variable — never a value, and
 *   never a URL (a URL can hold a token; `mcp-server-form.ts` refuses those and redacts the read).
 */
import type * as mcp from '@distilled.cloud/litellm/mcp_management';
import * as Data from 'effect/Data';

/** A declaration the resource refuses before any request: a combination nobody meant. */
export class LitellmMcpServerInvalidError extends Data.TaggedError('LitellmMcpServerInvalidError')<{
  readonly serverName: string;
  readonly problem: string;
}> {
  override get message(): string {
    return `LiteLLM.MCPServer "${this.serverName}": ${this.problem}.`;
  }
}

/**
 * A write must send the credential and the deploying process does not have it. An empty variable
 * counts as unset (secrets/write-only.ts: a failed renderer writes `NAME=`, and sending `''` would
 * store an empty credential and report a successful deploy).
 */
export class LitellmMcpServerCredentialEnvUnsetError extends Data.TaggedError(
  'LitellmMcpServerCredentialEnvUnsetError',
)<{
  readonly serverName: string;
  readonly variable: string;
}> {
  override get message(): string {
    return (
      `LiteLLM.MCPServer "${this.serverName}": this write must send its credential, and ` +
      `${this.variable} is unset or empty in the deploying environment. Export it and deploy again.`
    );
  }
}

/**
 * More than one live row carries the declared `server_name`, so adopt-by-name cannot say which one
 * is meant. LiteLLM does not make the name unique (unmeasured on 1.103.0). Declare `serverId` to
 * pick one — nothing is adopted, updated or deleted on a guess.
 */
export class LitellmMcpServerAmbiguousNameError extends Data.TaggedError(
  'LitellmMcpServerAmbiguousNameError',
)<{
  readonly serverName: string;
  readonly serverIds: readonly string[];
}> {
  override get message(): string {
    return (
      `LiteLLM.MCPServer "${this.serverName}": ${this.serverIds.length} live rows carry that ` +
      `server_name (${this.serverIds.join(', ')}). Declare \`serverId\` to choose one.`
    );
  }
}

/** `GET /v1/mcp/server` answered something that is not a list of servers. */
export class LitellmMcpServerUnreadableError extends Data.TaggedError(
  'LitellmMcpServerUnreadableError',
)<{
  readonly reason: string;
}> {
  override get message(): string {
    return `LiteLLM.MCPServer: the server list is unreadable (${this.reason}).`;
  }
}

/**
 * A create or edit returned no error, yet the row is absent on the read back: neither in the list
 * NOR in a database-backed read by id (the list alone is the registry, which can lag a commit).
 */
export class LitellmMcpServerAbsentAfterWriteError extends Data.TaggedError(
  'LitellmMcpServerAbsentAfterWriteError',
)<{
  readonly serverName: string;
  readonly serverId: string;
}> {
  override get message(): string {
    return (
      `LiteLLM.MCPServer "${this.serverName}": the write of ${this.serverId} returned no error ` +
      'but the row is absent from the list and from the database read.'
    );
  }
}

/**
 * The write returned no error but the row still differs from the declaration. The edit route may
 * merge with `exclude_none` or a truthiness check (an empty list or a `false` never lands); the
 * read back says so instead of reporting a converged row. Unmeasured on 1.103.0.
 */
export class LitellmMcpServerNotConvergedError extends Data.TaggedError(
  'LitellmMcpServerNotConvergedError',
)<{
  readonly serverName: string;
  readonly serverId: string;
  readonly fields: readonly string[];
}> {
  override get message(): string {
    return (
      `LiteLLM.MCPServer "${this.serverName}": after the write, ${this.serverId} still differs ` +
      `from the declaration in ${this.fields.join(', ')}.`
    );
  }
}

/**
 * The declared `description` cannot be applied: the live row's `mcp_info` has a `description` key
 * (even a null one), and LiteLLM answers that in preference to the column, which is all this
 * resource writes (`mcp_info` is not modelled). Raised BEFORE any write, so the row is untouched.
 * Nothing here names the text itself: a description is free text a person wrote.
 */
export class LitellmMcpServerDescriptionShadowedError extends Data.TaggedError(
  'LitellmMcpServerDescriptionShadowedError',
)<{
  readonly serverName: string;
  readonly serverId: string;
}> {
  override get message(): string {
    return (
      `LiteLLM.MCPServer "${this.serverName}": ${this.serverId} has a \`description\` in \`mcp_info\`, ` +
      'which LiteLLM shows instead of the column this resource writes, and it differs from the ' +
      'declaration. Edit it in LiteLLM, or remove `description` from the declaration.'
    );
  }
}

export type McpServerError =
  | mcp.AddMcpServerV1McpServerPostError
  | mcp.EditMcpServerV1McpServerPutError
  | mcp.FetchAllMcpServersV1McpServerGetError
  | mcp.FetchMcpServerV1McpServerServerIdGetError
  | mcp.RemoveMcpServerV1McpServerServerIdDeleteError
  | LitellmMcpServerInvalidError
  | LitellmMcpServerCredentialEnvUnsetError
  | LitellmMcpServerAmbiguousNameError
  | LitellmMcpServerUnreadableError
  | LitellmMcpServerAbsentAfterWriteError
  | LitellmMcpServerNotConvergedError
  | LitellmMcpServerDescriptionShadowedError;
