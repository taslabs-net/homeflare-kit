/**
 * Generated pve-manager API types for `/nodes/node/config` — DO NOT EDIT BY HAND.
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

/** GET /nodes/{node}/config — form/query parameters (path segments omitted). */
export type NodesNodeConfigGetParams = {
  property?:
    | 'acme'
    | 'acmedomain0'
    | 'acmedomain1'
    | 'acmedomain2'
    | 'acmedomain3'
    | 'acmedomain4'
    | 'acmedomain5'
    | 'ballooning-target'
    | 'description'
    | 'location'
    | 'startall-onboot-delay'
    | 'wakeonlan';
};
/** GET /nodes/{node}/config — `data` payload after client unwrap. */
export type NodesNodeConfigGetReturn = {
  acme?: string;
  'acmedomain[n]'?: string;
  'ballooning-target'?: number;
  description?: string;
  digest?: string;
  location?: string;
  'startall-onboot-delay'?: number;
  wakeonlan?: string;
} & Record<string, unknown>;

/** PUT /nodes/{node}/config — form/query parameters (path segments omitted). */
export type NodesNodeConfigPutParams = {
  acme?: string;
  'acmedomain[n]'?: string;
  'ballooning-target'?: `${number}`;
  delete?: string;
  description?: string;
  digest?: string;
  location?: string;
  'startall-onboot-delay'?: `${number}`;
  wakeonlan?: string;
};
/** PUT /nodes/{node}/config — `data` payload after client unwrap. */
export type NodesNodeConfigPutReturn = null;
