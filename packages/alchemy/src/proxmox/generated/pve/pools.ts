/**
 * Generated pve-manager API types for `/pools` — DO NOT EDIT BY HAND.
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

/** GET /pools — form/query parameters (path segments omitted). */
export type PoolsGetParams = { poolid?: string; type?: 'qemu' | 'lxc' | 'storage' };
/** GET /pools — `data` payload after client unwrap. */
export type PoolsGetReturn = readonly ({
  comment?: string;
  members?: readonly ({
    id: string;
    node: string;
    storage?: string;
    type: 'qemu' | 'lxc' | 'openvz' | 'storage';
    vmid?: number;
  } & Record<string, unknown>)[];
  poolid: string;
} & Record<string, unknown>)[];

/** POST /pools — form/query parameters (path segments omitted). */
export type PoolsPostParams = { comment?: string; poolid: string };
/** POST /pools — `data` payload after client unwrap. */
export type PoolsPostReturn = null;

/** PUT /pools — form/query parameters (path segments omitted). */
export type PoolsPutParams = {
  'allow-move'?: '0' | '1';
  comment?: string;
  delete?: '0' | '1';
  poolid: string;
  storage?: string;
  vms?: string;
};
/** PUT /pools — `data` payload after client unwrap. */
export type PoolsPutReturn = null;

/** DELETE /pools — form/query parameters (path segments omitted). */
export type PoolsDeleteParams = { poolid: string };
/** DELETE /pools — `data` payload after client unwrap. */
export type PoolsDeleteReturn = null;

/** GET /pools/{poolid} — form/query parameters (path segments omitted). */
export type PoolsPoolidGetParams = { type?: 'qemu' | 'lxc' | 'storage' };
/** GET /pools/{poolid} — `data` payload after client unwrap. */
export type PoolsPoolidGetReturn = {
  comment?: string;
  members: readonly ({
    id: string;
    node: string;
    storage?: string;
    type: 'qemu' | 'lxc' | 'openvz' | 'storage';
    vmid?: number;
  } & Record<string, unknown>)[];
};

/** PUT /pools/{poolid} — form/query parameters (path segments omitted). */
export type PoolsPoolidPutParams = {
  'allow-move'?: '0' | '1';
  comment?: string;
  delete?: '0' | '1';
  storage?: string;
  vms?: string;
};
/** PUT /pools/{poolid} — `data` payload after client unwrap. */
export type PoolsPoolidPutReturn = null;

/** DELETE /pools/{poolid} — `data` payload after client unwrap. */
export type PoolsPoolidDeleteReturn = null;
