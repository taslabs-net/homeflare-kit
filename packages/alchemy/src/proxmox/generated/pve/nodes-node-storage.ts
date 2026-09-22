/**
 * Generated pve-manager API types for `/nodes/node/storage` — DO NOT EDIT BY HAND.
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

/** GET /nodes/{node}/storage — form/query parameters (path segments omitted). */
export type NodesNodeStorageGetParams = {
  content?: string;
  enabled?: '0' | '1';
  format?: '0' | '1';
  storage?: string;
  target?: string;
};
/** GET /nodes/{node}/storage — `data` payload after client unwrap. */
export type NodesNodeStorageGetReturn = readonly ({
  active?: boolean | 0 | 1;
  avail?: number;
  content: string;
  enabled?: boolean | 0 | 1;
  formats?: {
    default: 'qcow2' | 'raw' | 'subvol' | 'vmdk';
    supported: readonly ('qcow2' | 'raw' | 'subvol' | 'vmdk')[];
  } & Record<string, unknown>;
  select_existing?: boolean | 0 | 1;
  shared?: boolean | 0 | 1;
  storage: string;
  total?: number;
  type: string;
  used?: number;
  used_fraction?: number;
} & Record<string, unknown>)[];
