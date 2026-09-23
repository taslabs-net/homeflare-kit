/**
 * Generated pve-manager API types for `/nodes/node/ceph` — DO NOT EDIT BY HAND.
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

/** POST /nodes/{node}/ceph/init — form/query parameters (path segments omitted). */
export type NodesNodeCephInitPostParams = {
  'cluster-network'?: string;
  disable_cephx?: '0' | '1';
  min_size?: `${number}`;
  network?: string;
  pg_bits?: `${number}`;
  size?: `${number}`;
};
/** POST /nodes/{node}/ceph/init — `data` payload after client unwrap. */
export type NodesNodeCephInitPostReturn = null;

/** GET /nodes/{node}/ceph/log — form/query parameters (path segments omitted). */
export type NodesNodeCephLogGetParams = { limit?: `${number}`; start?: `${number}` };
/** GET /nodes/{node}/ceph/log — `data` payload after client unwrap. */
export type NodesNodeCephLogGetReturn = readonly ({ n: number; t: string } & Record<string, unknown>)[];

/** GET /nodes/{node}/ceph/mds — `data` payload after client unwrap. */
export type NodesNodeCephMdsGetReturn = readonly ({
  addr?: string;
  ceph_version?: string;
  ceph_version_short?: string;
  direxists?: boolean | 0 | 1;
  fs_name?: string;
  host?: string;
  name: string;
  rank?: number;
  service?: boolean | 0 | 1;
  standby_replay?: boolean | 0 | 1;
  state: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/ceph/mds/{name} — form/query parameters (path segments omitted). */
export type NodesNodeCephMdsNamePostParams = { hotstandby?: '0' | '1' };
/** POST /nodes/{node}/ceph/mds/{name} — `data` payload after client unwrap. */
export type NodesNodeCephMdsNamePostReturn = string;

/** DELETE /nodes/{node}/ceph/mds/{name} — `data` payload after client unwrap. */
export type NodesNodeCephMdsNameDeleteReturn = string;

/** GET /nodes/{node}/ceph/mgr — `data` payload after client unwrap. */
export type NodesNodeCephMgrGetReturn = readonly ({
  addr?: string;
  ceph_version?: string;
  ceph_version_short?: string;
  direxists?: boolean | 0 | 1;
  host?: string;
  name: string;
  service?: boolean | 0 | 1;
  state: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/ceph/mgr/{id} — `data` payload after client unwrap. */
export type NodesNodeCephMgrIdPostReturn = string;

/** DELETE /nodes/{node}/ceph/mgr/{id} — `data` payload after client unwrap. */
export type NodesNodeCephMgrIdDeleteReturn = string;

/** GET /nodes/{node}/ceph/mon — `data` payload after client unwrap. */
export type NodesNodeCephMonGetReturn = readonly ({
  addr?: string;
  ceph_version?: string;
  ceph_version_short?: string;
  direxists?: boolean | 0 | 1;
  host?: string;
  name: string;
  quorum?: boolean | 0 | 1;
  rank?: number;
  service?: boolean | 0 | 1;
  state?: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/ceph/mon/{monid} — form/query parameters (path segments omitted). */
export type NodesNodeCephMonMonidPostParams = { 'mon-address'?: string };
/** POST /nodes/{node}/ceph/mon/{monid} — `data` payload after client unwrap. */
export type NodesNodeCephMonMonidPostReturn = string;

/** DELETE /nodes/{node}/ceph/mon/{monid} — `data` payload after client unwrap. */
export type NodesNodeCephMonMonidDeleteReturn = string;

/** GET /nodes/{node}/ceph/osd — `data` payload after client unwrap. */
export type NodesNodeCephOsdGetReturn = { flags?: string; root: unknown } & Record<string, unknown>;

/** POST /nodes/{node}/ceph/osd — form/query parameters (path segments omitted). */
export type NodesNodeCephOsdPostParams = {
  'crush-device-class'?: string;
  db_dev?: string;
  db_dev_size?: `${number}`;
  dev: string;
  encrypted?: '0' | '1';
  'osds-per-device'?: `${number}`;
  wal_dev?: string;
  wal_dev_size?: `${number}`;
};
/** POST /nodes/{node}/ceph/osd — `data` payload after client unwrap. */
export type NodesNodeCephOsdPostReturn = string;

/** GET /nodes/{node}/ceph/osd/{osdid} — `data` payload after client unwrap. */
export type NodesNodeCephOsdOsdidGetReturn = readonly Record<string, unknown>[];

/** DELETE /nodes/{node}/ceph/osd/{osdid} — form/query parameters (path segments omitted). */
export type NodesNodeCephOsdOsdidDeleteParams = { cleanup?: '0' | '1' };
/** DELETE /nodes/{node}/ceph/osd/{osdid} — `data` payload after client unwrap. */
export type NodesNodeCephOsdOsdidDeleteReturn = string;

/** GET /nodes/{node}/ceph/osd/{osdid}/metadata — `data` payload after client unwrap. */
export type NodesNodeCephOsdOsdidMetadataGetReturn = {
  devices: readonly ({
    dev_node: string;
    device: 'block' | 'db' | 'wal';
    physical_device: string;
    size: number;
    support_discard: boolean | 0 | 1;
    type: string;
  } & Record<string, unknown>)[];
  osd: {
    back_addr: string;
    encrypted: boolean | 0 | 1;
    front_addr: string;
    hb_back_addr: string;
    hb_front_addr: string;
    hostname: string;
    id: number;
    mem_usage: number;
    osd_data: string;
    osd_objectstore: string;
    pid?: number;
    version: string;
  } & Record<string, unknown>;
} & Record<string, unknown>;

/** GET /nodes/{node}/ceph/osd/{osdid}/lv-info — form/query parameters (path segments omitted). */
export type NodesNodeCephOsdOsdidLvInfoGetParams = { type?: 'block' | 'db' | 'wal' };
/** GET /nodes/{node}/ceph/osd/{osdid}/lv-info — `data` payload after client unwrap. */
export type NodesNodeCephOsdOsdidLvInfoGetReturn = {
  creation_time: string;
  lv_name: string;
  lv_path: string;
  lv_size: number;
  lv_uuid: string;
  vg_name: string;
} & Record<string, unknown>;

/** POST /nodes/{node}/ceph/osd/{osdid}/in — `data` payload after client unwrap. */
export type NodesNodeCephOsdOsdidInPostReturn = null;

/** POST /nodes/{node}/ceph/osd/{osdid}/out — `data` payload after client unwrap. */
export type NodesNodeCephOsdOsdidOutPostReturn = null;

/** POST /nodes/{node}/ceph/osd/{osdid}/scrub — form/query parameters (path segments omitted). */
export type NodesNodeCephOsdOsdidScrubPostParams = { deep?: '0' | '1' };
/** POST /nodes/{node}/ceph/osd/{osdid}/scrub — `data` payload after client unwrap. */
export type NodesNodeCephOsdOsdidScrubPostReturn = null;
