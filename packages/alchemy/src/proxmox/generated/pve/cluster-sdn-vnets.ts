/**
 * Generated pve-manager API types for `/cluster/sdn/vnets` — DO NOT EDIT BY HAND.
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

/** GET /cluster/sdn/vnets — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/vnets — `data` payload after client unwrap. */
export type ClusterSdnVnetsGetReturn = readonly ({
  alias?: string;
  digest?: string;
  'isolate-ports'?: boolean | 0 | 1;
  pending?: {
    alias?: string;
    'isolate-ports'?: boolean | 0 | 1;
    tag?: number;
    vlanaware?: boolean | 0 | 1;
    zone?: string;
  } & Record<string, unknown>;
  state?: 'new' | 'changed' | 'deleted';
  tag?: number;
  type: 'vnet';
  vlanaware?: boolean | 0 | 1;
  vnet: string;
  zone?: string;
} & Record<string, unknown>)[];

/** POST /cluster/sdn/vnets — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsPostParams = {
  alias?: string;
  'isolate-ports'?: '0' | '1';
  'lock-token'?: string;
  tag?: `${number}`;
  type?: 'vnet';
  vlanaware?: '0' | '1';
  vnet: string;
  zone: string;
};
/** POST /cluster/sdn/vnets — `data` payload after client unwrap. */
export type ClusterSdnVnetsPostReturn = null;
