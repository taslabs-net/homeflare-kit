/**
 * Generated pve-manager API types for `/nodes/node/lxc/vmid/mtunnel` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/types.ts    (`--check` compares without writing)
 * Manifest entry: `pve-apidoc` — pve-manager 9.2.11/f6997e698c7933ea
 *   sha256 9def8f13611184ee, read on a PVE cluster node from
 *   /usr/share/pve-docs/api-viewer/apidoc.js
 *
 * ⚠️ A REQUEST PARAMETER IS TEXT ON THE WIRE. `client.ts` sends form encoding, so an integer is
 *   `\`${number}\`` and a boolean is `'0' | '1'` — the spellings that reach the server. The
 *   vendor's BOUNDS on those values are enforced separately, at plan time, from
 *   pve/../constraints (codegen/README.md). A response is JSON and is not spelled that way.
 */

/** POST /nodes/{node}/lxc/{vmid}/mtunnel — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidMtunnelPostParams = { bridges?: string; storages?: string };
/** POST /nodes/{node}/lxc/{vmid}/mtunnel — `data` payload after client unwrap. */
export type NodesNodeLxcVmidMtunnelPostReturn = { socket: string; ticket: string; upid: string };

/** GET /nodes/{node}/lxc/{vmid}/mtunnelwebsocket — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidMtunnelwebsocketGetParams = { socket: string; ticket: string };
/** GET /nodes/{node}/lxc/{vmid}/mtunnelwebsocket — `data` payload after client unwrap. */
export type NodesNodeLxcVmidMtunnelwebsocketGetReturn = {
  port?: string;
  socket?: string;
} & Record<string, unknown>;

/** GET /nodes/{node}/lxc/{vmid}/pending — `data` payload after client unwrap. */
export type NodesNodeLxcVmidPendingGetReturn = readonly ({
  delete?: number;
  key: string;
  pending?: string;
  value?: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/lxc/{vmid}/remote_migrate — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidRemote_migratePostParams = {
  bwlimit?: `${number}`;
  delete?: '0' | '1';
  online?: '0' | '1';
  restart?: '0' | '1';
  'target-bridge': string;
  'target-endpoint': string;
  'target-storage': string;
  'target-vmid'?: `${number}`;
  timeout?: `${number}`;
};
/** POST /nodes/{node}/lxc/{vmid}/remote_migrate — `data` payload after client unwrap. */
export type NodesNodeLxcVmidRemote_migratePostReturn = string;
