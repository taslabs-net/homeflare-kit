/**
 * Generated pve-manager API types for `/cluster/replication` — DO NOT EDIT BY HAND.
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

/** GET /cluster/replication — `data` payload after client unwrap. */
export type ClusterReplicationGetReturn = readonly ({
  comment?: string;
  disable?: boolean | 0 | 1;
  guest: number;
  id: string;
  jobnum: number;
  rate?: number;
  remove_job?: 'local' | 'full';
  schedule?: string;
  source?: string;
  target: string;
  type: 'local';
} & Record<string, unknown>)[];

/** POST /cluster/replication — form/query parameters (path segments omitted). */
export type ClusterReplicationPostParams = {
  comment?: string;
  disable?: '0' | '1';
  id: string;
  rate?: `${number}`;
  remove_job?: 'local' | 'full';
  schedule?: string;
  source?: string;
  target: string;
  type: 'local';
};
/** POST /cluster/replication — `data` payload after client unwrap. */
export type ClusterReplicationPostReturn = null;

/** GET /cluster/replication/{id} — `data` payload after client unwrap. */
export type ClusterReplicationIdGetReturn = {
  comment?: string;
  digest?: string;
  disable?: boolean | 0 | 1;
  guest: number;
  id: string;
  jobnum: number;
  rate?: number;
  remove_job?: 'local' | 'full';
  schedule?: string;
  source?: string;
  target: string;
  type: 'local';
} & Record<string, unknown>;

/** PUT /cluster/replication/{id} — form/query parameters (path segments omitted). */
export type ClusterReplicationIdPutParams = {
  comment?: string;
  delete?: string;
  digest?: string;
  disable?: '0' | '1';
  rate?: `${number}`;
  remove_job?: 'local' | 'full';
  schedule?: string;
  source?: string;
};
/** PUT /cluster/replication/{id} — `data` payload after client unwrap. */
export type ClusterReplicationIdPutReturn = null;

/** DELETE /cluster/replication/{id} — form/query parameters (path segments omitted). */
export type ClusterReplicationIdDeleteParams = { force?: '0' | '1'; keep?: '0' | '1' };
/** DELETE /cluster/replication/{id} — `data` payload after client unwrap. */
export type ClusterReplicationIdDeleteReturn = null;

/** GET /cluster/resources — form/query parameters (path segments omitted). */
export type ClusterResourcesGetParams = { type?: 'vm' | 'storage' | 'node' | 'sdn' };
/** GET /cluster/resources — `data` payload after client unwrap. */
export type ClusterResourcesGetReturn = readonly ({
  'cgroup-mode'?: number;
  content?: string;
  cpu?: number;
  disk?: number;
  diskread?: number;
  diskwrite?: number;
  hastate?: string;
  'host-arch'?: 'x86_64' | 'aarch64';
  id: string;
  level?: string;
  lock?: string;
  maxcpu?: number;
  maxdisk?: number;
  maxmem?: number;
  mem?: number;
  memhost?: number;
  name?: string;
  netin?: number;
  netout?: number;
  network?: string;
  'network-type'?: 'fabric' | 'zone';
  node?: string;
  plugintype?: string;
  pool?: string;
  protocol?: string;
  sdn?: string;
  shared?: boolean | 0 | 1;
  status?: string;
  storage?: string;
  tags?: string;
  template?: boolean | 0 | 1;
  type: 'node' | 'storage' | 'pool' | 'qemu' | 'lxc' | 'openvz' | 'sdn' | 'network';
  uptime?: number;
  vmid?: number;
  'zone-type'?: string;
} & Record<string, unknown>)[];

/** GET /cluster/sdn — `data` payload after client unwrap. */
export type ClusterSdnGetReturn = readonly ({ id: string } & Record<string, unknown>)[];

/** PUT /cluster/sdn — form/query parameters (path segments omitted). */
export type ClusterSdnPutParams = { 'lock-token'?: string; 'release-lock'?: '0' | '1' };
/** PUT /cluster/sdn — `data` payload after client unwrap. */
export type ClusterSdnPutReturn = string;
