/**
 * Generated pve-manager API types for `/cluster/sdn/fabrics` — DO NOT EDIT BY HAND.
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

/** GET /cluster/sdn/fabrics — `data` payload after client unwrap. */
export type ClusterSdnFabricsGetReturn = readonly ({ subdir: string } & Record<string, unknown>)[];

/** GET /cluster/sdn/fabrics/fabric — form/query parameters (path segments omitted). */
export type ClusterSdnFabricsFabricGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/fabrics/fabric — `data` payload after client unwrap. */
export type ClusterSdnFabricsFabricGetReturn = readonly ({
  area?: string;
  csnp_interval?: number;
  digest?: string;
  hello_interval?: number;
  id: string;
  ip6_prefix?: string;
  ip_prefix?: string;
  'lock-token'?: string;
  persistent_keepalive?: number;
  protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
  redistribute?: readonly string[];
  route_filter?: string;
} & Record<string, unknown>)[];

/** POST /cluster/sdn/fabrics/fabric — form/query parameters (path segments omitted). */
export type ClusterSdnFabricsFabricPostParams = {
  area?: string;
  csnp_interval?: `${number}`;
  digest?: string;
  hello_interval?: `${number}`;
  id: string;
  ip6_prefix?: string;
  ip_prefix?: string;
  'lock-token'?: string;
  persistent_keepalive?: `${number}`;
  protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
  redistribute?: readonly string[];
  route_filter?: string;
};
/** POST /cluster/sdn/fabrics/fabric — `data` payload after client unwrap. */
export type ClusterSdnFabricsFabricPostReturn = null;

/** GET /cluster/sdn/fabrics/fabric/{id} — `data` payload after client unwrap. */
export type ClusterSdnFabricsFabricIdGetReturn = {
  area?: string;
  csnp_interval?: number;
  digest?: string;
  hello_interval?: number;
  id: string;
  ip6_prefix?: string;
  ip_prefix?: string;
  'lock-token'?: string;
  persistent_keepalive?: number;
  protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
  redistribute?: readonly string[];
  route_filter?: string;
} & Record<string, unknown>;

/** PUT /cluster/sdn/fabrics/fabric/{id} — form/query parameters (path segments omitted). */
export type ClusterSdnFabricsFabricIdPutParams = {
  area?: string;
  csnp_interval?: `${number}`;
  delete?: readonly (
    | 'ip_prefix'
    | 'ip6_prefix'
    | 'hello_interval'
    | 'csnp_interval'
    | 'route_filter'
    | 'redistribute'
    | 'route_map_in'
    | 'route_map_out'
    | 'area'
    | 'persistent_keepalive')[];
  digest?: string;
  hello_interval?: `${number}`;
  ip6_prefix?: string;
  ip_prefix?: string;
  'lock-token'?: string;
  persistent_keepalive?: `${number}`;
  protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
  redistribute?: readonly string[];
  route_filter?: string;
};
/** PUT /cluster/sdn/fabrics/fabric/{id} — `data` payload after client unwrap. */
export type ClusterSdnFabricsFabricIdPutReturn = null;

/** DELETE /cluster/sdn/fabrics/fabric/{id} — `data` payload after client unwrap. */
export type ClusterSdnFabricsFabricIdDeleteReturn = null;

/** GET /cluster/sdn/fabrics/node — form/query parameters (path segments omitted). */
export type ClusterSdnFabricsNodeGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/fabrics/node — `data` payload after client unwrap. */
export type ClusterSdnFabricsNodeGetReturn = readonly ({
  allowed_ips?: readonly string[];
  digest?: string;
  endpoint?: string;
  fabric_id: string;
  interfaces?: readonly string[];
  ip?: string;
  ip6?: string;
  'lock-token'?: string;
  node_id: string;
  peers?: readonly string[];
  protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
  public_key?: string;
  role?: 'internal' | 'external';
} & Record<string, unknown>)[];

/** GET /cluster/sdn/fabrics/node/{fabric_id} — form/query parameters (path segments omitted). */
export type ClusterSdnFabricsNodeFabric_idGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/fabrics/node/{fabric_id} — `data` payload after client unwrap. */
export type ClusterSdnFabricsNodeFabric_idGetReturn = readonly ({
  allowed_ips?: readonly string[];
  digest?: string;
  endpoint?: string;
  fabric_id: string;
  interfaces?: readonly string[];
  ip?: string;
  ip6?: string;
  'lock-token'?: string;
  node_id: string;
  peers?: readonly string[];
  protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
  public_key?: string;
  role?: 'internal' | 'external';
} & Record<string, unknown>)[];

/** POST /cluster/sdn/fabrics/node/{fabric_id} — form/query parameters (path segments omitted). */
export type ClusterSdnFabricsNodeFabric_idPostParams = {
  allowed_ips?: readonly string[];
  digest?: string;
  endpoint?: string;
  interfaces?: readonly string[];
  ip?: string;
  ip6?: string;
  'lock-token'?: string;
  node_id: string;
  peers?: readonly string[];
  protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
  public_key?: string;
  role?: 'internal' | 'external';
};
/** POST /cluster/sdn/fabrics/node/{fabric_id} — `data` payload after client unwrap. */
export type ClusterSdnFabricsNodeFabric_idPostReturn = null;

/** GET /cluster/sdn/fabrics/node/{fabric_id}/{node_id} — `data` payload after client unwrap. */
export type ClusterSdnFabricsNodeFabric_idNode_idGetReturn = {
  allowed_ips?: readonly string[];
  digest?: string;
  endpoint?: string;
  fabric_id: string;
  interfaces?: readonly string[];
  ip?: string;
  ip6?: string;
  'lock-token'?: string;
  node_id: string;
  peers?: readonly string[];
  protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
  public_key?: string;
  role?: 'internal' | 'external';
} & Record<string, unknown>;

/** PUT /cluster/sdn/fabrics/node/{fabric_id}/{node_id} — form/query parameters (path segments omitted). */
export type ClusterSdnFabricsNodeFabric_idNode_idPutParams = {
  allowed_ips?: readonly string[];
  delete?: readonly ('interfaces' | 'ip' | 'ip6' | 'allowed_ips' | 'endpoint' | 'peers')[];
  digest?: string;
  endpoint?: string;
  interfaces?: readonly string[];
  ip?: string;
  ip6?: string;
  'lock-token'?: string;
  peers?: readonly string[];
  protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
  public_key?: string;
  role?: 'internal' | 'external';
};
/** PUT /cluster/sdn/fabrics/node/{fabric_id}/{node_id} — `data` payload after client unwrap. */
export type ClusterSdnFabricsNodeFabric_idNode_idPutReturn = null;

/** DELETE /cluster/sdn/fabrics/node/{fabric_id}/{node_id} — `data` payload after client unwrap. */
export type ClusterSdnFabricsNodeFabric_idNode_idDeleteReturn = null;

/** GET /cluster/sdn/fabrics/all — form/query parameters (path segments omitted). */
export type ClusterSdnFabricsAllGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/fabrics/all — `data` payload after client unwrap. */
export type ClusterSdnFabricsAllGetReturn = {
  fabrics: readonly ({
    area?: string;
    csnp_interval?: number;
    digest?: string;
    hello_interval?: number;
    id: string;
    ip6_prefix?: string;
    ip_prefix?: string;
    'lock-token'?: string;
    persistent_keepalive?: number;
    protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
    redistribute?: readonly string[];
    route_filter?: string;
  } & Record<string, unknown>)[];
  nodes: readonly ({
    allowed_ips?: readonly string[];
    digest?: string;
    endpoint?: string;
    fabric_id: string;
    interfaces?: readonly string[];
    ip?: string;
    ip6?: string;
    'lock-token'?: string;
    node_id: string;
    peers?: readonly string[];
    protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
    public_key?: string;
    role?: 'internal' | 'external';
  } & Record<string, unknown>)[];
} & Record<string, unknown>;
