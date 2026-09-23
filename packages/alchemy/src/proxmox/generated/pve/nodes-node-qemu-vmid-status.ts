/**
 * Generated pve-manager API types for `/nodes/node/qemu/vmid/status` — DO NOT EDIT BY HAND.
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

/** GET /nodes/{node}/qemu/{vmid}/status — `data` payload after client unwrap. */
export type NodesNodeQemuVmidStatusGetReturn = readonly ({
  subdir: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/qemu/{vmid}/status/current — `data` payload after client unwrap. */
export type NodesNodeQemuVmidStatusCurrentGetReturn = {
  agent?: boolean | 0 | 1;
  clipboard?: 'vnc';
  cpu?: number;
  cpus?: number;
  diskread?: number;
  diskwrite?: number;
  ha: unknown;
  lock?: string;
  maxdisk?: number;
  maxmem?: number;
  mem?: number;
  memhost?: number;
  name?: string;
  netin?: number;
  netout?: number;
  pid?: number;
  pressurecpufull?: number;
  pressurecpusome?: number;
  pressureiofull?: number;
  pressureiosome?: number;
  pressurememoryfull?: number;
  pressurememorysome?: number;
  qmpstatus?: string;
  'running-machine'?: string;
  'running-qemu'?: string;
  serial?: boolean | 0 | 1;
  spice?: boolean | 0 | 1;
  status: 'stopped' | 'running';
  tags?: string;
  template?: boolean | 0 | 1;
  uptime?: number;
  vmid: number;
} & Record<string, unknown>;

/** POST /nodes/{node}/qemu/{vmid}/status/start — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidStatusStartPostParams = {
  'force-cpu'?: string;
  machine?: string;
  migratedfrom?: string;
  migration_network?: string;
  migration_type?: 'secure' | 'insecure';
  'nets-host-mtu'?: string;
  skiplock?: '0' | '1';
  stateuri?: string;
  targetstorage?: string;
  timeout?: `${number}`;
  'with-conntrack-state'?: '0' | '1';
};
/** POST /nodes/{node}/qemu/{vmid}/status/start — `data` payload after client unwrap. */
export type NodesNodeQemuVmidStatusStartPostReturn = string;

/** POST /nodes/{node}/qemu/{vmid}/status/stop — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidStatusStopPostParams = {
  keepActive?: '0' | '1';
  migratedfrom?: string;
  'overrule-shutdown'?: '0' | '1';
  skiplock?: '0' | '1';
  timeout?: `${number}`;
};
/** POST /nodes/{node}/qemu/{vmid}/status/stop — `data` payload after client unwrap. */
export type NodesNodeQemuVmidStatusStopPostReturn = string;

/** POST /nodes/{node}/qemu/{vmid}/status/reset — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidStatusResetPostParams = { skiplock?: '0' | '1' };
/** POST /nodes/{node}/qemu/{vmid}/status/reset — `data` payload after client unwrap. */
export type NodesNodeQemuVmidStatusResetPostReturn = string;

/** POST /nodes/{node}/qemu/{vmid}/status/shutdown — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidStatusShutdownPostParams = {
  forceStop?: '0' | '1';
  keepActive?: '0' | '1';
  skiplock?: '0' | '1';
  timeout?: `${number}`;
};
/** POST /nodes/{node}/qemu/{vmid}/status/shutdown — `data` payload after client unwrap. */
export type NodesNodeQemuVmidStatusShutdownPostReturn = string;

/** POST /nodes/{node}/qemu/{vmid}/status/reboot — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidStatusRebootPostParams = { timeout?: `${number}` };
/** POST /nodes/{node}/qemu/{vmid}/status/reboot — `data` payload after client unwrap. */
export type NodesNodeQemuVmidStatusRebootPostReturn = string;

/** POST /nodes/{node}/qemu/{vmid}/status/suspend — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidStatusSuspendPostParams = {
  skiplock?: '0' | '1';
  statestorage?: string;
  todisk?: '0' | '1';
};
/** POST /nodes/{node}/qemu/{vmid}/status/suspend — `data` payload after client unwrap. */
export type NodesNodeQemuVmidStatusSuspendPostReturn = string;

/** POST /nodes/{node}/qemu/{vmid}/status/resume — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidStatusResumePostParams = { nocheck?: '0' | '1'; skiplock?: '0' | '1' };
/** POST /nodes/{node}/qemu/{vmid}/status/resume — `data` payload after client unwrap. */
export type NodesNodeQemuVmidStatusResumePostReturn = string;

/** POST /nodes/{node}/qemu/{vmid}/template — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidTemplatePostParams = {
  disk?:
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
};
/** POST /nodes/{node}/qemu/{vmid}/template — `data` payload after client unwrap. */
export type NodesNodeQemuVmidTemplatePostReturn = string;

/** POST /nodes/{node}/qemu/{vmid}/termproxy — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidTermproxyPostParams = {
  serial?: 'serial0' | 'serial1' | 'serial2' | 'serial3';
};
/** POST /nodes/{node}/qemu/{vmid}/termproxy — `data` payload after client unwrap. */
export type NodesNodeQemuVmidTermproxyPostReturn = {
  port: number;
  ticket: string;
  upid: string;
  user: string;
};

/** PUT /nodes/{node}/qemu/{vmid}/unlink — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidUnlinkPutParams = { force?: '0' | '1'; idlist: string };
/** PUT /nodes/{node}/qemu/{vmid}/unlink — `data` payload after client unwrap. */
export type NodesNodeQemuVmidUnlinkPutReturn = null;

/** POST /nodes/{node}/qemu/{vmid}/vncproxy — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidVncproxyPostParams = {
  'generate-password'?: '0' | '1';
  websocket?: '0' | '1';
};
/** POST /nodes/{node}/qemu/{vmid}/vncproxy — `data` payload after client unwrap. */
export type NodesNodeQemuVmidVncproxyPostReturn = {
  cert: string;
  password?: string;
  port: number;
  ticket: string;
  upid: string;
  user: string;
};

/** GET /nodes/{node}/qemu/{vmid}/vncwebsocket — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidVncwebsocketGetParams = { port: `${number}`; vncticket: string };
/** GET /nodes/{node}/qemu/{vmid}/vncwebsocket — `data` payload after client unwrap. */
export type NodesNodeQemuVmidVncwebsocketGetReturn = { port: string } & Record<string, unknown>;

/** GET /nodes/{node}/query-oci-repo-tags — form/query parameters (path segments omitted). */
export type NodesNodeQueryOciRepoTagsGetParams = { reference: string };
/** GET /nodes/{node}/query-oci-repo-tags — `data` payload after client unwrap. */
export type NodesNodeQueryOciRepoTagsGetReturn = readonly string[];

/** GET /nodes/{node}/query-url-metadata — form/query parameters (path segments omitted). */
export type NodesNodeQueryUrlMetadataGetParams = { url: string; 'verify-certificates'?: '0' | '1' };
/** GET /nodes/{node}/query-url-metadata — `data` payload after client unwrap. */
export type NodesNodeQueryUrlMetadataGetReturn = {
  filename?: string;
  mimetype?: string;
  size?: number;
} & Record<string, unknown>;
