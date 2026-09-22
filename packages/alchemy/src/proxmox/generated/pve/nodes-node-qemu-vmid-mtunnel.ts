/**
 * Generated pve-manager API types for `/nodes/node/qemu/vmid/mtunnel` — DO NOT EDIT BY HAND.
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

/** POST /nodes/{node}/qemu/{vmid}/mtunnel — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidMtunnelPostParams = { bridges?: string; storages?: string };
/** POST /nodes/{node}/qemu/{vmid}/mtunnel — `data` payload after client unwrap. */
export type NodesNodeQemuVmidMtunnelPostReturn = { socket: string; ticket: string; upid: string };

/** GET /nodes/{node}/qemu/{vmid}/mtunnelwebsocket — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidMtunnelwebsocketGetParams = { socket: string; ticket: string };
/** GET /nodes/{node}/qemu/{vmid}/mtunnelwebsocket — `data` payload after client unwrap. */
export type NodesNodeQemuVmidMtunnelwebsocketGetReturn = {
  port?: string;
  socket?: string;
} & Record<string, unknown>;

/** GET /nodes/{node}/qemu/{vmid}/pending — `data` payload after client unwrap. */
export type NodesNodeQemuVmidPendingGetReturn = readonly ({
  delete?: number;
  key: string;
  pending?: string;
  value?: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/qemu/{vmid}/remote_migrate — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidRemote_migratePostParams = {
  bwlimit?: `${number}`;
  delete?: '0' | '1';
  online?: '0' | '1';
  'target-bridge': string;
  'target-endpoint': string;
  'target-storage': string;
  'target-vmid'?: `${number}`;
};
/** POST /nodes/{node}/qemu/{vmid}/remote_migrate — `data` payload after client unwrap. */
export type NodesNodeQemuVmidRemote_migratePostReturn = string;

/** PUT /nodes/{node}/qemu/{vmid}/resize — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidResizePutParams = {
  digest?: string;
  disk:
    | 'ide0'
    | 'ide1'
    | 'ide2'
    | 'ide3'
    | 'scsi0'
    | 'scsi1'
    | 'scsi2'
    | 'scsi3'
    | 'scsi4'
    | 'scsi5'
    | 'scsi6'
    | 'scsi7'
    | 'scsi8'
    | 'scsi9'
    | 'scsi10'
    | 'scsi11'
    | 'scsi12'
    | 'scsi13'
    | 'scsi14'
    | 'scsi15'
    | 'scsi16'
    | 'scsi17'
    | 'scsi18'
    | 'scsi19'
    | 'scsi20'
    | 'scsi21'
    | 'scsi22'
    | 'scsi23'
    | 'scsi24'
    | 'scsi25'
    | 'scsi26'
    | 'scsi27'
    | 'scsi28'
    | 'scsi29'
    | 'scsi30'
    | 'virtio0'
    | 'virtio1'
    | 'virtio2'
    | 'virtio3'
    | 'virtio4'
    | 'virtio5'
    | 'virtio6'
    | 'virtio7'
    | 'virtio8'
    | 'virtio9'
    | 'virtio10'
    | 'virtio11'
    | 'virtio12'
    | 'virtio13'
    | 'virtio14'
    | 'virtio15'
    | 'sata0'
    | 'sata1'
    | 'sata2'
    | 'sata3'
    | 'sata4'
    | 'sata5'
    | 'efidisk0'
    | 'tpmstate0';
  size: string;
  skiplock?: '0' | '1';
};
/** PUT /nodes/{node}/qemu/{vmid}/resize — `data` payload after client unwrap. */
export type NodesNodeQemuVmidResizePutReturn = string;

/** GET /nodes/{node}/qemu/{vmid}/rrd — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidRrdGetParams = {
  cf?: 'AVERAGE' | 'MAX';
  ds: string;
  timeframe: 'hour' | 'day' | 'week' | 'month' | 'year';
};
/** GET /nodes/{node}/qemu/{vmid}/rrd — `data` payload after client unwrap. */
export type NodesNodeQemuVmidRrdGetReturn = { filename: string } & Record<string, unknown>;

/** GET /nodes/{node}/qemu/{vmid}/rrddata — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidRrddataGetParams = {
  cf?: 'AVERAGE' | 'MAX';
  timeframe: 'hour' | 'day' | 'week' | 'month' | 'year';
};
/** GET /nodes/{node}/qemu/{vmid}/rrddata — `data` payload after client unwrap. */
export type NodesNodeQemuVmidRrddataGetReturn = readonly Record<string, unknown>[];

/** PUT /nodes/{node}/qemu/{vmid}/sendkey — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidSendkeyPutParams = { key: string; skiplock?: '0' | '1' };
/** PUT /nodes/{node}/qemu/{vmid}/sendkey — `data` payload after client unwrap. */
export type NodesNodeQemuVmidSendkeyPutReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/snapshot — `data` payload after client unwrap. */
export type NodesNodeQemuVmidSnapshotGetReturn = readonly ({
  description: string;
  name: string;
  parent?: string;
  snaptime?: number;
  vmstate?: boolean | 0 | 1;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/qemu/{vmid}/snapshot — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidSnapshotPostParams = {
  description?: string;
  snapname: string;
  vmstate?: '0' | '1';
};
/** POST /nodes/{node}/qemu/{vmid}/snapshot — `data` payload after client unwrap. */
export type NodesNodeQemuVmidSnapshotPostReturn = string;

/** GET /nodes/{node}/qemu/{vmid}/snapshot/{snapname} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidSnapshotSnapnameGetReturn = readonly Record<string, unknown>[];

/** DELETE /nodes/{node}/qemu/{vmid}/snapshot/{snapname} — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidSnapshotSnapnameDeleteParams = { force?: '0' | '1' };
/** DELETE /nodes/{node}/qemu/{vmid}/snapshot/{snapname} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidSnapshotSnapnameDeleteReturn = string;

/** GET /nodes/{node}/qemu/{vmid}/snapshot/{snapname}/config — `data` payload after client unwrap. */
export type NodesNodeQemuVmidSnapshotSnapnameConfigGetReturn = unknown;

/** PUT /nodes/{node}/qemu/{vmid}/snapshot/{snapname}/config — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidSnapshotSnapnameConfigPutParams = { description?: string };
/** PUT /nodes/{node}/qemu/{vmid}/snapshot/{snapname}/config — `data` payload after client unwrap. */
export type NodesNodeQemuVmidSnapshotSnapnameConfigPutReturn = null;

/** POST /nodes/{node}/qemu/{vmid}/snapshot/{snapname}/rollback — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidSnapshotSnapnameRollbackPostParams = { start?: '0' | '1' };
/** POST /nodes/{node}/qemu/{vmid}/snapshot/{snapname}/rollback — `data` payload after client unwrap. */
export type NodesNodeQemuVmidSnapshotSnapnameRollbackPostReturn = string;

/** POST /nodes/{node}/qemu/{vmid}/spiceproxy — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidSpiceproxyPostParams = { proxy?: string };
/** POST /nodes/{node}/qemu/{vmid}/spiceproxy — `data` payload after client unwrap. */
export type NodesNodeQemuVmidSpiceproxyPostReturn = {
  host: string;
  password: string;
  proxy: string;
  'tls-port': number;
  type: string;
} & Record<string, unknown>;
