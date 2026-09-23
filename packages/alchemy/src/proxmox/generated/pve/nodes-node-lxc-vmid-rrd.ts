/**
 * Generated pve-manager API types for `/nodes/node/lxc/vmid/rrd` — DO NOT EDIT BY HAND.
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

/** GET /nodes/{node}/lxc/{vmid}/rrd — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidRrdGetParams = {
  cf?: 'AVERAGE' | 'MAX';
  ds: string;
  timeframe: 'hour' | 'day' | 'week' | 'month' | 'year';
};
/** GET /nodes/{node}/lxc/{vmid}/rrd — `data` payload after client unwrap. */
export type NodesNodeLxcVmidRrdGetReturn = { filename: string } & Record<string, unknown>;

/** GET /nodes/{node}/lxc/{vmid}/rrddata — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidRrddataGetParams = {
  cf?: 'AVERAGE' | 'MAX';
  timeframe: 'hour' | 'day' | 'week' | 'month' | 'year';
};
/** GET /nodes/{node}/lxc/{vmid}/rrddata — `data` payload after client unwrap. */
export type NodesNodeLxcVmidRrddataGetReturn = readonly Record<string, unknown>[];

/** GET /nodes/{node}/lxc/{vmid}/snapshot — `data` payload after client unwrap. */
export type NodesNodeLxcVmidSnapshotGetReturn = readonly ({
  description: string;
  name: string;
  parent?: string;
  snaptime?: number;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/lxc/{vmid}/snapshot — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidSnapshotPostParams = { description?: string; snapname: string };
/** POST /nodes/{node}/lxc/{vmid}/snapshot — `data` payload after client unwrap. */
export type NodesNodeLxcVmidSnapshotPostReturn = string;

/** GET /nodes/{node}/lxc/{vmid}/snapshot/{snapname} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidSnapshotSnapnameGetReturn = readonly Record<string, unknown>[];

/** DELETE /nodes/{node}/lxc/{vmid}/snapshot/{snapname} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidSnapshotSnapnameDeleteParams = { force?: '0' | '1' };
/** DELETE /nodes/{node}/lxc/{vmid}/snapshot/{snapname} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidSnapshotSnapnameDeleteReturn = string;

/** POST /nodes/{node}/lxc/{vmid}/snapshot/{snapname}/rollback — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidSnapshotSnapnameRollbackPostParams = { start?: '0' | '1' };
/** POST /nodes/{node}/lxc/{vmid}/snapshot/{snapname}/rollback — `data` payload after client unwrap. */
export type NodesNodeLxcVmidSnapshotSnapnameRollbackPostReturn = string;

/** GET /nodes/{node}/lxc/{vmid}/snapshot/{snapname}/config — `data` payload after client unwrap. */
export type NodesNodeLxcVmidSnapshotSnapnameConfigGetReturn = unknown;

/** PUT /nodes/{node}/lxc/{vmid}/snapshot/{snapname}/config — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidSnapshotSnapnameConfigPutParams = { description?: string };
/** PUT /nodes/{node}/lxc/{vmid}/snapshot/{snapname}/config — `data` payload after client unwrap. */
export type NodesNodeLxcVmidSnapshotSnapnameConfigPutReturn = null;

/** POST /nodes/{node}/lxc/{vmid}/spiceproxy — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidSpiceproxyPostParams = { proxy?: string };
/** POST /nodes/{node}/lxc/{vmid}/spiceproxy — `data` payload after client unwrap. */
export type NodesNodeLxcVmidSpiceproxyPostReturn = {
  host: string;
  password: string;
  proxy: string;
  'tls-port': number;
  type: string;
} & Record<string, unknown>;

/** GET /nodes/{node}/lxc/{vmid}/status — `data` payload after client unwrap. */
export type NodesNodeLxcVmidStatusGetReturn = readonly ({ subdir: string } & Record<string, unknown>)[];

/** GET /nodes/{node}/lxc/{vmid}/status/current — `data` payload after client unwrap. */
export type NodesNodeLxcVmidStatusCurrentGetReturn = {
  cpu?: number;
  cpus?: number;
  disk?: number;
  diskread?: number;
  diskwrite?: number;
  ha: unknown;
  lock?: string;
  maxdisk?: number;
  maxmem?: number;
  maxswap?: number;
  mem?: number;
  name?: string;
  netin?: number;
  netout?: number;
  pressurecpusome?: number;
  pressureiofull?: number;
  pressureiosome?: number;
  pressurememoryfull?: number;
  pressurememorysome?: number;
  status: 'stopped' | 'running';
  tags?: string;
  template?: boolean | 0 | 1;
  uptime?: number;
  vmid: number;
} & Record<string, unknown>;

/** POST /nodes/{node}/lxc/{vmid}/status/start — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidStatusStartPostParams = { debug?: '0' | '1'; skiplock?: '0' | '1' };
/** POST /nodes/{node}/lxc/{vmid}/status/start — `data` payload after client unwrap. */
export type NodesNodeLxcVmidStatusStartPostReturn = string;

/** POST /nodes/{node}/lxc/{vmid}/status/stop — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidStatusStopPostParams = {
  'overrule-shutdown'?: '0' | '1';
  skiplock?: '0' | '1';
};
/** POST /nodes/{node}/lxc/{vmid}/status/stop — `data` payload after client unwrap. */
export type NodesNodeLxcVmidStatusStopPostReturn = string;

/** POST /nodes/{node}/lxc/{vmid}/status/shutdown — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidStatusShutdownPostParams = {
  forceStop?: '0' | '1';
  timeout?: `${number}`;
};
/** POST /nodes/{node}/lxc/{vmid}/status/shutdown — `data` payload after client unwrap. */
export type NodesNodeLxcVmidStatusShutdownPostReturn = string;

/** POST /nodes/{node}/lxc/{vmid}/status/suspend — `data` payload after client unwrap. */
export type NodesNodeLxcVmidStatusSuspendPostReturn = string;

/** POST /nodes/{node}/lxc/{vmid}/status/resume — `data` payload after client unwrap. */
export type NodesNodeLxcVmidStatusResumePostReturn = string;

/** POST /nodes/{node}/lxc/{vmid}/status/reboot — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidStatusRebootPostParams = { timeout?: `${number}` };
/** POST /nodes/{node}/lxc/{vmid}/status/reboot — `data` payload after client unwrap. */
export type NodesNodeLxcVmidStatusRebootPostReturn = string;

/** POST /nodes/{node}/lxc/{vmid}/template — `data` payload after client unwrap. */
export type NodesNodeLxcVmidTemplatePostReturn = null;

/** POST /nodes/{node}/lxc/{vmid}/termproxy — `data` payload after client unwrap. */
export type NodesNodeLxcVmidTermproxyPostReturn = {
  port: number;
  ticket: string;
  upid: string;
  user: string;
};

/** POST /nodes/{node}/lxc/{vmid}/vncproxy — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidVncproxyPostParams = {
  height?: `${number}`;
  websocket?: '0' | '1';
  width?: `${number}`;
};
/** POST /nodes/{node}/lxc/{vmid}/vncproxy — `data` payload after client unwrap. */
export type NodesNodeLxcVmidVncproxyPostReturn = {
  cert: string;
  password?: string;
  port: number;
  ticket: string;
  upid: string;
  user: string;
};

/** GET /nodes/{node}/lxc/{vmid}/vncwebsocket — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidVncwebsocketGetParams = { port: `${number}`; vncticket: string };
/** GET /nodes/{node}/lxc/{vmid}/vncwebsocket — `data` payload after client unwrap. */
export type NodesNodeLxcVmidVncwebsocketGetReturn = { port: string } & Record<string, unknown>;

/** POST /nodes/{node}/migrateall — form/query parameters (path segments omitted). */
export type NodesNodeMigrateallPostParams = {
  'max-workers'?: `${number}`;
  maxworkers?: `${number}`;
  target: string;
  vms?: string;
  'with-local-disks'?: '0' | '1';
};
/** POST /nodes/{node}/migrateall — `data` payload after client unwrap. */
export type NodesNodeMigrateallPostReturn = string;

/** GET /nodes/{node}/netstat — `data` payload after client unwrap. */
export type NodesNodeNetstatGetReturn = readonly Record<string, unknown>[];
