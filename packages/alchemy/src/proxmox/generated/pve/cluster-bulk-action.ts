/**
 * Generated pve-manager API types for `/cluster/bulk/action` — DO NOT EDIT BY HAND.
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

/** GET /cluster/bulk-action — `data` payload after client unwrap. */
export type ClusterBulkActionGetReturn = readonly unknown[];

/** GET /cluster/bulk-action/guest — `data` payload after client unwrap. */
export type ClusterBulkActionGuestGetReturn = readonly Record<string, unknown>[];

/** POST /cluster/bulk-action/guest/start — form/query parameters (path segments omitted). */
export type ClusterBulkActionGuestStartPostParams = {
  'max-workers'?: `${number}`;
  maxworkers?: `${number}`;
  timeout?: `${number}`;
  vms?: readonly `${number}`[];
};
/** POST /cluster/bulk-action/guest/start — `data` payload after client unwrap. */
export type ClusterBulkActionGuestStartPostReturn = string;

/** POST /cluster/bulk-action/guest/shutdown — form/query parameters (path segments omitted). */
export type ClusterBulkActionGuestShutdownPostParams = {
  'force-stop'?: '0' | '1';
  'max-workers'?: `${number}`;
  maxworkers?: `${number}`;
  timeout?: `${number}`;
  vms?: readonly `${number}`[];
};
/** POST /cluster/bulk-action/guest/shutdown — `data` payload after client unwrap. */
export type ClusterBulkActionGuestShutdownPostReturn = string;

/** POST /cluster/bulk-action/guest/suspend — form/query parameters (path segments omitted). */
export type ClusterBulkActionGuestSuspendPostParams = {
  'max-workers'?: `${number}`;
  maxworkers?: `${number}`;
  statestorage?: string;
  'to-disk'?: '0' | '1';
  vms?: readonly `${number}`[];
};
/** POST /cluster/bulk-action/guest/suspend — `data` payload after client unwrap. */
export type ClusterBulkActionGuestSuspendPostReturn = string;

/** POST /cluster/bulk-action/guest/migrate — form/query parameters (path segments omitted). */
export type ClusterBulkActionGuestMigratePostParams = {
  'max-workers'?: `${number}`;
  maxworkers?: `${number}`;
  online?: '0' | '1';
  target: string;
  vms?: readonly `${number}`[];
  'with-local-disks'?: '0' | '1';
};
/** POST /cluster/bulk-action/guest/migrate — `data` payload after client unwrap. */
export type ClusterBulkActionGuestMigratePostReturn = string;

/** GET /cluster/ceph — `data` payload after client unwrap. */
export type ClusterCephGetReturn = readonly Record<string, unknown>[];

/** GET /cluster/ceph/metadata — form/query parameters (path segments omitted). */
export type ClusterCephMetadataGetParams = { scope?: 'all' | 'versions' };
/** GET /cluster/ceph/metadata — `data` payload after client unwrap. */
export type ClusterCephMetadataGetReturn = {
  mds: unknown;
  mgr: unknown;
  mon: unknown;
  node: unknown;
  osd: readonly ({
    back_addr: string;
    ceph_release: string;
    ceph_version: string;
    ceph_version_short: string;
    device_ids?: string;
    device_paths?: string;
    devices?: string;
    front_addr: string;
    hostname: string;
    id: number;
    mem_swap_kb: number;
    mem_total_kb: number;
    osd_data: string;
    osd_objectstore: string;
  } & Record<string, unknown>)[];
} & Record<string, unknown>;

/** GET /cluster/ceph/status — `data` payload after client unwrap. */
export type ClusterCephStatusGetReturn = unknown;

/** POST /cluster/ceph/restart-bulk — form/query parameters (path segments omitted). */
export type ClusterCephRestartBulkPostParams = {
  'dry-run'?: '0' | '1';
  force?: '0' | '1';
  'only-outdated'?: '0' | '1';
  'service-type': 'mon' | 'mgr' | 'mds' | 'osd';
  timeout?: `${number}`;
};
/** POST /cluster/ceph/restart-bulk — `data` payload after client unwrap. */
export type ClusterCephRestartBulkPostReturn = string;

/** GET /cluster/ceph/flags — `data` payload after client unwrap. */
export type ClusterCephFlagsGetReturn = readonly ({
  description: string;
  name:
    | 'nobackfill'
    | 'nodeep-scrub'
    | 'nodown'
    | 'noin'
    | 'noout'
    | 'norebalance'
    | 'norecover'
    | 'noscrub'
    | 'notieragent'
    | 'noup'
    | 'pause';
  value: boolean | 0 | 1;
} & Record<string, unknown>)[];

/** PUT /cluster/ceph/flags — form/query parameters (path segments omitted). */
export type ClusterCephFlagsPutParams = {
  nobackfill?: '0' | '1';
  'nodeep-scrub'?: '0' | '1';
  nodown?: '0' | '1';
  noin?: '0' | '1';
  noout?: '0' | '1';
  norebalance?: '0' | '1';
  norecover?: '0' | '1';
  noscrub?: '0' | '1';
  notieragent?: '0' | '1';
  noup?: '0' | '1';
  pause?: '0' | '1';
};
/** PUT /cluster/ceph/flags — `data` payload after client unwrap. */
export type ClusterCephFlagsPutReturn = string;

/** GET /cluster/ceph/flags/{flag} — `data` payload after client unwrap. */
export type ClusterCephFlagsFlagGetReturn = boolean | 0 | 1;

/** PUT /cluster/ceph/flags/{flag} — form/query parameters (path segments omitted). */
export type ClusterCephFlagsFlagPutParams = { value: '0' | '1' };
/** PUT /cluster/ceph/flags/{flag} — `data` payload after client unwrap. */
export type ClusterCephFlagsFlagPutReturn = null;

/** GET /cluster/config — `data` payload after client unwrap. */
export type ClusterConfigGetReturn = readonly Record<string, unknown>[];

/** POST /cluster/config — form/query parameters (path segments omitted). */
export type ClusterConfigPostParams = {
  clustername: string;
  'link[n]'?: string;
  nodeid?: `${number}`;
  'token-coefficient'?: `${number}`;
  votes?: `${number}`;
};
/** POST /cluster/config — `data` payload after client unwrap. */
export type ClusterConfigPostReturn = string;

/** GET /cluster/config/apiversion — `data` payload after client unwrap. */
export type ClusterConfigApiversionGetReturn = number;

/** GET /cluster/config/nodes — `data` payload after client unwrap. */
export type ClusterConfigNodesGetReturn = readonly ({ node: string } & Record<string, unknown>)[];

/** POST /cluster/config/nodes/{node} — form/query parameters (path segments omitted). */
export type ClusterConfigNodesNodePostParams = {
  apiversion?: `${number}`;
  force?: '0' | '1';
  'link[n]'?: string;
  new_node_ip?: string;
  nodeid?: `${number}`;
  votes?: `${number}`;
};
/** POST /cluster/config/nodes/{node} — `data` payload after client unwrap. */
export type ClusterConfigNodesNodePostReturn = {
  corosync_authkey: string;
  corosync_conf: string;
  warnings: readonly string[];
} & Record<string, unknown>;

/** DELETE /cluster/config/nodes/{node} — `data` payload after client unwrap. */
export type ClusterConfigNodesNodeDeleteReturn = null;

/** GET /cluster/config/join — form/query parameters (path segments omitted). */
export type ClusterConfigJoinGetParams = { node?: string };
/** GET /cluster/config/join — `data` payload after client unwrap. */
export type ClusterConfigJoinGetReturn = {
  config_digest: string;
  nodelist: readonly ({
    name: string;
    nodeid?: number;
    pve_addr: string;
    pve_fp: string;
    quorum_votes: number;
    ring0_addr?: string;
  } & Record<string, unknown>)[];
  preferred_node: string;
  totem: unknown;
};

/** POST /cluster/config/join — form/query parameters (path segments omitted). */
export type ClusterConfigJoinPostParams = {
  fingerprint: string;
  force?: '0' | '1';
  hostname: string;
  'link[n]'?: string;
  nodeid?: `${number}`;
  password: string;
  votes?: `${number}`;
};
/** POST /cluster/config/join — `data` payload after client unwrap. */
export type ClusterConfigJoinPostReturn = string;

/** GET /cluster/config/totem — `data` payload after client unwrap. */
export type ClusterConfigTotemGetReturn = unknown;

/** GET /cluster/config/qdevice — `data` payload after client unwrap. */
export type ClusterConfigQdeviceGetReturn = unknown;

/** GET /cluster/firewall — `data` payload after client unwrap. */
export type ClusterFirewallGetReturn = readonly Record<string, unknown>[];
