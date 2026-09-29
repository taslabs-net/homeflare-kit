/**
 * @homeflare/seat-runtime — what every HomeFlare coding seat shares: the model and telemetry
 * layers, the round loop, and MCP servers as a toolkit.
 *
 * ⛔ RUNTIME-NEUTRAL: nothing here imports `bun:*` or `node:*`. It rides `fetch`, so it runs
 *   under Bun, Node and workerd alike. ⚠️ That includes the MCP SDK's client entry: its import
 *   graph has no `node:` module (asserted in tests/pairing.test.ts), but its default JSON Schema
 *   validator is `ajv`, which needs `new Function`, so workerd is untested for `mcpToolkit`.
 */
export * as SeatModel from './seat-model.ts';
export * as SeatObs from './seat-obs.ts';
export { runRounds } from './rounds.ts';
export type { Round, RoundsOptions, RoundsResult } from './rounds.ts';
export { mcpToolkit } from './mcp-toolkit.ts';
export type {
  McpHeaders,
  McpResource,
  McpResourceContent,
  McpToolkit,
  McpToolkitOptions,
  McpTools,
} from './mcp-toolkit.ts';
export { McpToolkitError } from './mcp-error.ts';
export { VERSION } from './version.ts';
