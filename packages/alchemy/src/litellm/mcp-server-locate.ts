/**
 * Which live row a `LiteLLM.MCPServer` declaration means, and which id a new row would ask for.
 *
 * ⛔ THE LIST DECIDES FIRST, THE DATABASE SECOND. `GET /v1/mcp/server` is LiteLLM's in-memory
 *   registry, not the table (mcp-server-operations.ts says how a committed row can be missing from
 *   it). A row the list does not show is therefore looked for BY ID in the database, with the id
 *   this declaration would use. Without that second read, a row created a moment ago whose
 *   registry refresh failed would be POSTed again: the id is deterministic, LiteLLM answers 400
 *   "already exists", and the resource would be wedged on a row it can neither see nor adopt.
 * ⚠️ ADOPT-BY-NAME NEEDS THE LIST: a name cannot be read from the table by this route family. A row
 *   the registry lacks is adoptable only by declaring its `serverId`.
 */
import type * as mcp from '@distilled.cloud/litellm/mcp_management';
import { createPhysicalName } from 'alchemy/PhysicalName';
import * as Effect from 'effect/Effect';
import { LitellmMcpServerAmbiguousNameError } from './mcp-server-errors.ts';
import { listMcpServers, readMcpServer } from './mcp-server-operations.ts';
import type { McpServerAttributes, McpServerProps } from './mcp-server-types.ts';

/**
 * The live row among the LISTED ones, or `undefined`. A pinned id (from state, else declared) wins;
 * otherwise the name decides, and an ambiguous name is refused.
 */
export const locate = (
  rows: readonly mcp.LiteLLMMCPServerTable[],
  props: McpServerProps,
  output: McpServerAttributes | undefined,
) => {
  const pinned = output?.serverId ?? props.serverId;
  if (pinned !== undefined) return Effect.succeed(rows.find((row) => row.server_id === pinned));
  const named = rows.filter((row) => row.server_name === props.serverName);
  return named.length > 1
    ? Effect.fail(
        new LitellmMcpServerAmbiguousNameError({
          serverIds: named.map((row) => row.server_id),
          serverName: props.serverName,
        }),
      )
    : Effect.succeed(named[0]);
};

/** The id a create asks for: the recorded one, else the declared one, else a deterministic name. */
export const wantedId = (
  id: string,
  instanceId: string,
  props: McpServerProps,
  output: McpServerAttributes | undefined,
) =>
  output?.serverId !== undefined
    ? Effect.succeed(output.serverId)
    : props.serverId !== undefined
      ? Effect.succeed(props.serverId)
      : createPhysicalName({ id, instanceId, lowercase: true, maxLength: 64 });

/** The live row this declaration means, from the list, else from the table by the id it would use. */
export const findLive = (
  id: string,
  instanceId: string,
  props: McpServerProps,
  output: McpServerAttributes | undefined,
) =>
  Effect.gen(function* () {
    const listed = yield* locate(yield* listMcpServers(), props, output);
    if (listed !== undefined) return listed;
    return yield* readMcpServer(yield* wantedId(id, instanceId, props, output));
  });
