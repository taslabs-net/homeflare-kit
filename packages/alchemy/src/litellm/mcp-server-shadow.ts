/**
 * The one description this resource cannot write: a row whose `mcp_info` already has a
 * `description` key.
 *
 * ⛔ MEASURED 2026-09-29 on the live 1.103.0 container and its database (read only): the list route
 *   builds each row's `description` from `mcp_info.get("description")` (`_build_mcp_server_table`),
 *   and registering a row copies the `description` COLUMN into `mcp_info` only when the KEY IS ABSENT
 *   from `mcp_info` (`build_mcp_server_from_table`, `"description" not in mcp_info`). This resource
 *   writes the column and models no `mcp_info`, so on a row whose `mcp_info` has the key, a declared
 *   description lands in the column and is never read back, and every deploy would fail
 *   `LitellmMcpServerNotConvergedError` after the write. Live: 2 of the 9 rows in
 *   `LiteLLM_MCPServerTable` have the key: `linear` (a string, with the same length as its column)
 *   and `Memos_CF` (a JSON null, with a NULL column). A key holding null shadows the column too.
 * ★ THE ROW IS READ BY ID FROM THE TABLE, because the list's `mcp_info` already has the column
 *   folded in: a description in it could be either, and only the table row tells them apart.
 * ⚠️ Not `mcp_info` merging: a sent `mcp_info` REPLACES the stored one, and the list's copy carries
 *   fields the proxy adds on the way out (`is_public`), which would be persisted.
 */
import * as Effect from 'effect/Effect';
import { LitellmMcpServerDescriptionShadowedError } from './mcp-server-errors.ts';
import { readMcpServer } from './mcp-server-operations.ts';
import type { McpServerProps } from './mcp-server-types.ts';

/** Fails BEFORE any write when the declared description would be hidden by the row's `mcp_info`. */
export const refuseShadowedDescription = (props: McpServerProps, serverId: string) =>
  props.description === undefined
    ? Effect.void
    : readMcpServer(serverId).pipe(
        Effect.flatMap((row) => {
          const info = row?.mcp_info;
          const shadowed =
            info !== undefined &&
            info !== null &&
            'description' in info &&
            info['description'] !== props.description;
          return shadowed
            ? Effect.fail(
                new LitellmMcpServerDescriptionShadowedError({
                  serverId,
                  serverName: props.serverName,
                }),
              )
            : Effect.void;
        }),
      );
