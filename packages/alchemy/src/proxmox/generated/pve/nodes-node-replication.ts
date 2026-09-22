/**
 * Generated pve-manager API types for `/nodes/node/replication` — DO NOT EDIT BY HAND.
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

/** GET /nodes/{node}/replication — form/query parameters (path segments omitted). */
export type NodesNodeReplicationGetParams = { guest?: `${number}` };
/** GET /nodes/{node}/replication — `data` payload after client unwrap. */
export type NodesNodeReplicationGetReturn = readonly ({ id: string } & Record<string, unknown>)[];

/** GET /nodes/{node}/replication/{id} — `data` payload after client unwrap. */
export type NodesNodeReplicationIdGetReturn = readonly Record<string, unknown>[];

/** GET /nodes/{node}/replication/{id}/status — `data` payload after client unwrap. */
export type NodesNodeReplicationIdStatusGetReturn = unknown;

/** GET /nodes/{node}/replication/{id}/log — form/query parameters (path segments omitted). */
export type NodesNodeReplicationIdLogGetParams = { limit?: `${number}`; start?: `${number}` };
/** GET /nodes/{node}/replication/{id}/log — `data` payload after client unwrap. */
export type NodesNodeReplicationIdLogGetReturn = readonly ({
  n: number;
  t: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/replication/{id}/schedule_now — `data` payload after client unwrap. */
export type NodesNodeReplicationIdSchedule_nowPostReturn = string;

/** GET /nodes/{node}/report — `data` payload after client unwrap. */
export type NodesNodeReportGetReturn = string;

/** GET /nodes/{node}/rrd — form/query parameters (path segments omitted). */
export type NodesNodeRrdGetParams = {
  cf?: 'AVERAGE' | 'MAX';
  ds: string;
  timeframe: 'hour' | 'day' | 'week' | 'month' | 'year' | 'decade';
};
/** GET /nodes/{node}/rrd — `data` payload after client unwrap. */
export type NodesNodeRrdGetReturn = { filename: string } & Record<string, unknown>;

/** GET /nodes/{node}/rrddata — form/query parameters (path segments omitted). */
export type NodesNodeRrddataGetParams = {
  cf?: 'AVERAGE' | 'MAX';
  timeframe: 'hour' | 'day' | 'week' | 'month' | 'year' | 'decade';
};
/** GET /nodes/{node}/rrddata — `data` payload after client unwrap. */
export type NodesNodeRrddataGetReturn = readonly Record<string, unknown>[];

/** GET /nodes/{node}/scan — `data` payload after client unwrap. */
export type NodesNodeScanGetReturn = readonly ({ method: string } & Record<string, unknown>)[];

/** GET /nodes/{node}/scan/nfs — form/query parameters (path segments omitted). */
export type NodesNodeScanNfsGetParams = { server: string };
/** GET /nodes/{node}/scan/nfs — `data` payload after client unwrap. */
export type NodesNodeScanNfsGetReturn = readonly ({
  options: string;
  path: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/scan/cifs — form/query parameters (path segments omitted). */
export type NodesNodeScanCifsGetParams = {
  domain?: string;
  password?: string;
  server: string;
  username?: string;
};
/** GET /nodes/{node}/scan/cifs — `data` payload after client unwrap. */
export type NodesNodeScanCifsGetReturn = readonly ({
  description: string;
  share: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/scan/pbs — form/query parameters (path segments omitted). */
export type NodesNodeScanPbsGetParams = {
  fingerprint?: string;
  password: string;
  port?: `${number}`;
  server: string;
  username: string;
};
/** GET /nodes/{node}/scan/pbs — `data` payload after client unwrap. */
export type NodesNodeScanPbsGetReturn = readonly ({
  comment?: string;
  store: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/scan/iscsi — form/query parameters (path segments omitted). */
export type NodesNodeScanIscsiGetParams = { portal: string };
/** GET /nodes/{node}/scan/iscsi — `data` payload after client unwrap. */
export type NodesNodeScanIscsiGetReturn = readonly ({
  portal: string;
  target: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/scan/lvm — `data` payload after client unwrap. */
export type NodesNodeScanLvmGetReturn = readonly ({ vg: string } & Record<string, unknown>)[];

/** GET /nodes/{node}/scan/lvmthin — form/query parameters (path segments omitted). */
export type NodesNodeScanLvmthinGetParams = { vg: string };
/** GET /nodes/{node}/scan/lvmthin — `data` payload after client unwrap. */
export type NodesNodeScanLvmthinGetReturn = readonly ({ lv: string } & Record<string, unknown>)[];

/** GET /nodes/{node}/scan/zfs — `data` payload after client unwrap. */
export type NodesNodeScanZfsGetReturn = readonly ({ pool: string } & Record<string, unknown>)[];

/** GET /nodes/{node}/sdn — `data` payload after client unwrap. */
export type NodesNodeSdnGetReturn = readonly Record<string, unknown>[];

/** GET /nodes/{node}/sdn/fabrics/{fabric} — `data` payload after client unwrap. */
export type NodesNodeSdnFabricsFabricGetReturn = readonly ({
  subdir: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/sdn/fabrics/{fabric}/routes — `data` payload after client unwrap. */
export type NodesNodeSdnFabricsFabricRoutesGetReturn = readonly ({
  route: string;
  via: readonly string[];
} & Record<string, unknown>)[];

/** GET /nodes/{node}/sdn/fabrics/{fabric}/neighbors — `data` payload after client unwrap. */
export type NodesNodeSdnFabricsFabricNeighborsGetReturn = readonly ({
  neighbor: string;
  status: string;
  uptime: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/sdn/fabrics/{fabric}/interfaces — `data` payload after client unwrap. */
export type NodesNodeSdnFabricsFabricInterfacesGetReturn = readonly ({
  name: string;
  state: string;
  type: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/sdn/zones — `data` payload after client unwrap. */
export type NodesNodeSdnZonesGetReturn = readonly ({
  status: 'available' | 'pending' | 'error';
  zone: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/sdn/zones/{zone} — `data` payload after client unwrap. */
export type NodesNodeSdnZonesZoneGetReturn = readonly ({ subdir: string } & Record<string, unknown>)[];

/** GET /nodes/{node}/sdn/zones/{zone}/content — `data` payload after client unwrap. */
export type NodesNodeSdnZonesZoneContentGetReturn = readonly ({
  status?: string;
  statusmsg?: string;
  vnet: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/sdn/zones/{zone}/bridges — `data` payload after client unwrap. */
export type NodesNodeSdnZonesZoneBridgesGetReturn = readonly ({
  name: string;
  ports: readonly ({
    index?: string;
    name: string;
    primary_vlan?: number;
    vlans?: readonly string[];
    vmid?: number;
  } & Record<string, unknown>)[];
  vlan_filtering: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/sdn/zones/{zone}/ip-vrf — `data` payload after client unwrap. */
export type NodesNodeSdnZonesZoneIpVrfGetReturn = readonly ({
  ip: string;
  metric: number;
  nexthops: readonly string[];
  protocol: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/sdn/vnets/{vnet} — `data` payload after client unwrap. */
export type NodesNodeSdnVnetsVnetGetReturn = readonly ({ subdir: string } & Record<string, unknown>)[];

/** GET /nodes/{node}/sdn/vnets/{vnet}/mac-vrf — `data` payload after client unwrap. */
export type NodesNodeSdnVnetsVnetMacVrfGetReturn = readonly ({
  ip: string;
  mac: string;
  nexthop: string;
} & Record<string, unknown>)[];
