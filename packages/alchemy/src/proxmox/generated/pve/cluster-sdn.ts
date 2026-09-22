/**
 * Generated pve-manager API types for `/cluster/sdn` — DO NOT EDIT BY HAND.
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

/** GET /cluster/sdn/controllers — form/query parameters (path segments omitted). */
export type ClusterSdnControllersGetParams = {
  pending?: '0' | '1';
  running?: '0' | '1';
  type?: 'bgp' | 'evpn' | 'faucet' | 'isis';
};
/** GET /cluster/sdn/controllers — `data` payload after client unwrap. */
export type ClusterSdnControllersGetReturn = readonly ({
  asn?: number;
  'bgp-mode'?: 'auto' | 'external' | 'internal';
  'bgp-multipath-as-relax'?: boolean | 0 | 1;
  controller: string;
  digest?: string;
  ebgp?: boolean | 0 | 1;
  'ebgp-multihop'?: number;
  'isis-domain'?: string;
  'isis-ifaces'?: string;
  'isis-net'?: string;
  loopback?: string;
  node?: string;
  nodes?: string;
  'peer-group-name'?: string;
  peers?: string;
  pending?: {
    asn?: number;
    'bgp-mode'?: 'auto' | 'external' | 'internal';
    'bgp-multipath-as-relax'?: boolean | 0 | 1;
    ebgp?: boolean | 0 | 1;
    'ebgp-multihop'?: number;
    'isis-domain'?: string;
    'isis-ifaces'?: string;
    'isis-net'?: string;
    loopback?: string;
    node?: string;
    nodes?: string;
    'peer-group-name'?: string;
    peers?: string;
  } & Record<string, unknown>;
  state?: 'new' | 'changed' | 'deleted';
  type: 'bgp' | 'evpn' | 'faucet' | 'isis';
} & Record<string, unknown>)[];

/** POST /cluster/sdn/controllers — form/query parameters (path segments omitted). */
export type ClusterSdnControllersPostParams = {
  asn?: `${number}`;
  'bgp-mode'?: 'auto' | 'external' | 'internal';
  'bgp-multipath-as-path-relax'?: '0' | '1';
  controller: string;
  ebgp?: '0' | '1';
  'ebgp-multihop'?: `${number}`;
  fabric?: string;
  'isis-domain'?: string;
  'isis-ifaces'?: string;
  'isis-net'?: string;
  'lock-token'?: string;
  loopback?: string;
  node?: string;
  nodes?: string;
  'peer-group-name'?: string;
  peers?: string;
  'route-map-in'?: string;
  'route-map-out'?: string;
  type: 'bgp' | 'evpn' | 'faucet' | 'isis';
};
/** POST /cluster/sdn/controllers — `data` payload after client unwrap. */
export type ClusterSdnControllersPostReturn = null;

/** GET /cluster/sdn/controllers/{controller} — form/query parameters (path segments omitted). */
export type ClusterSdnControllersControllerGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/controllers/{controller} — `data` payload after client unwrap. */
export type ClusterSdnControllersControllerGetReturn = {
  asn?: number;
  'bgp-mode'?: 'auto' | 'external' | 'internal';
  'bgp-multipath-as-relax'?: boolean | 0 | 1;
  controller: string;
  digest?: string;
  ebgp?: boolean | 0 | 1;
  'ebgp-multihop'?: number;
  'isis-domain'?: string;
  'isis-ifaces'?: string;
  'isis-net'?: string;
  loopback?: string;
  node?: string;
  nodes?: string;
  'peer-group-name'?: string;
  peers?: string;
  pending?: {
    asn?: number;
    'bgp-mode'?: 'auto' | 'external' | 'internal';
    'bgp-multipath-as-relax'?: boolean | 0 | 1;
    ebgp?: boolean | 0 | 1;
    'ebgp-multihop'?: number;
    'isis-domain'?: string;
    'isis-ifaces'?: string;
    'isis-net'?: string;
    loopback?: string;
    node?: string;
    nodes?: string;
    'peer-group-name'?: string;
    peers?: string;
  } & Record<string, unknown>;
  state?: 'new' | 'changed' | 'deleted';
  type: 'bgp' | 'evpn' | 'faucet' | 'isis';
} & Record<string, unknown>;

/** PUT /cluster/sdn/controllers/{controller} — form/query parameters (path segments omitted). */
export type ClusterSdnControllersControllerPutParams = {
  asn?: `${number}`;
  'bgp-mode'?: 'auto' | 'external' | 'internal';
  'bgp-multipath-as-path-relax'?: '0' | '1';
  delete?: string;
  digest?: string;
  ebgp?: '0' | '1';
  'ebgp-multihop'?: `${number}`;
  fabric?: string;
  'isis-domain'?: string;
  'isis-ifaces'?: string;
  'isis-net'?: string;
  'lock-token'?: string;
  loopback?: string;
  node?: string;
  nodes?: string;
  'peer-group-name'?: string;
  peers?: string;
  'route-map-in'?: string;
  'route-map-out'?: string;
};
/** PUT /cluster/sdn/controllers/{controller} — `data` payload after client unwrap. */
export type ClusterSdnControllersControllerPutReturn = null;

/** DELETE /cluster/sdn/controllers/{controller} — form/query parameters (path segments omitted). */
export type ClusterSdnControllersControllerDeleteParams = { 'lock-token'?: string };
/** DELETE /cluster/sdn/controllers/{controller} — `data` payload after client unwrap. */
export type ClusterSdnControllersControllerDeleteReturn = null;

/** GET /cluster/sdn/dns — form/query parameters (path segments omitted). */
export type ClusterSdnDnsGetParams = { type?: 'powerdns' };
/** GET /cluster/sdn/dns — `data` payload after client unwrap. */
export type ClusterSdnDnsGetReturn = readonly ({
  dns: string;
  type: string;
} & Record<string, unknown>)[];

/** POST /cluster/sdn/dns — form/query parameters (path segments omitted). */
export type ClusterSdnDnsPostParams = {
  dns: string;
  fingerprint?: string;
  key: string;
  'lock-token'?: string;
  reversemaskv6?: `${number}`;
  reversev6mask?: `${number}`;
  ttl?: `${number}`;
  type: 'powerdns';
  url: string;
};
/** POST /cluster/sdn/dns — `data` payload after client unwrap. */
export type ClusterSdnDnsPostReturn = null;

/** GET /cluster/sdn/dns/{dns} — `data` payload after client unwrap. */
export type ClusterSdnDnsDnsGetReturn = unknown;

/** PUT /cluster/sdn/dns/{dns} — form/query parameters (path segments omitted). */
export type ClusterSdnDnsDnsPutParams = {
  delete?: string;
  digest?: string;
  fingerprint?: string;
  key?: string;
  'lock-token'?: string;
  reversemaskv6?: `${number}`;
  ttl?: `${number}`;
  url?: string;
};
/** PUT /cluster/sdn/dns/{dns} — `data` payload after client unwrap. */
export type ClusterSdnDnsDnsPutReturn = null;

/** DELETE /cluster/sdn/dns/{dns} — form/query parameters (path segments omitted). */
export type ClusterSdnDnsDnsDeleteParams = { 'lock-token'?: string };
/** DELETE /cluster/sdn/dns/{dns} — `data` payload after client unwrap. */
export type ClusterSdnDnsDnsDeleteReturn = null;

/** GET /cluster/sdn/dry-run — form/query parameters (path segments omitted). */
export type ClusterSdnDryRunGetParams = { node: string };
/** GET /cluster/sdn/dry-run — `data` payload after client unwrap. */
export type ClusterSdnDryRunGetReturn = {
  'frr-diff'?: string;
  'interfaces-diff'?: string;
} & Record<string, unknown>;
