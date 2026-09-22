/**
 * Generated proxmox-backup-server API types for `/nodes/node/services` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/types.ts    (`--check` compares without writing)
 * Manifest entry: `pbs-apidoc` — proxmox-backup-server 4.2.6-1 (running 4.2.3)
 *   sha256 274ab9f6fc075aea, read on a PBS host from
 *   /usr/share/doc/proxmox-backup/html/api-viewer/apidoc.js
 *
 * ⚠️ A REQUEST PARAMETER IS TEXT ON THE WIRE. `client.ts` sends form encoding, so an integer is
 *   `\`${number}\`` and a boolean is `'0' | '1'` — the spellings that reach the server. The
 *   vendor's BOUNDS on those values are enforced separately, at plan time, from
 *   pbs/../constraints (codegen/README.md). A response is JSON and is not spelled that way.
 */

/** GET /nodes/{node}/services — `data` payload after client unwrap. */
export type NodesNodeServicesGetReturn = readonly {
  desc: string;
  name: string;
  service: string;
  state: string;
  'unit-state': string;
}[];

/** GET /nodes/{node}/services/{service} — `data` payload after client unwrap. */
export type NodesNodeServicesServiceGetReturn = null;

/** POST /nodes/{node}/services/{service}/reload — `data` payload after client unwrap. */
export type NodesNodeServicesServiceReloadPostReturn = null;

/** POST /nodes/{node}/services/{service}/restart — `data` payload after client unwrap. */
export type NodesNodeServicesServiceRestartPostReturn = null;

/** POST /nodes/{node}/services/{service}/start — `data` payload after client unwrap. */
export type NodesNodeServicesServiceStartPostReturn = null;

/** GET /nodes/{node}/services/{service}/state — `data` payload after client unwrap. */
export type NodesNodeServicesServiceStateGetReturn = null;

/** POST /nodes/{node}/services/{service}/stop — `data` payload after client unwrap. */
export type NodesNodeServicesServiceStopPostReturn = null;

/** GET /nodes/{node}/status — `data` payload after client unwrap. */
export type NodesNodeStatusGetReturn = {
  'boot-info': { mode: 'efi' | 'legacy-bios'; secureboot: boolean | 0 | 1 };
  cpu: number;
  cpuinfo: { cpus: number; model: string; sockets: number };
  'current-kernel': { machine: string; release: string; sysname: string; version: string };
  info: { fingerprint: string };
  kversion: string;
  loadavg: readonly number[];
  memory: { free: number; total: number; used: number };
  root: { avail: number; total: number; used: number };
  swap: { free: number; total: number; used: number };
  uptime: number;
  wait: number;
};

/** POST /nodes/{node}/status — form/query parameters (path segments omitted). */
export type NodesNodeStatusPostParams = { command: 'reboot' | 'shutdown' };
/** POST /nodes/{node}/status — `data` payload after client unwrap. */
export type NodesNodeStatusPostReturn = null;

/** GET /nodes/{node}/subscription — `data` payload after client unwrap. */
export type NodesNodeSubscriptionGetReturn = {
  checktime?: number;
  key?: string;
  message?: string;
  nextduedate?: string;
  productname?: string;
  regdate?: string;
  serverid?: string;
  signature?: string;
  status: 'new' | 'notfound' | 'active' | 'invalid' | 'expired' | 'suspended';
  url?: string;
};

/** POST /nodes/{node}/subscription — form/query parameters (path segments omitted). */
export type NodesNodeSubscriptionPostParams = { force?: '0' | '1' };
/** POST /nodes/{node}/subscription — `data` payload after client unwrap. */
export type NodesNodeSubscriptionPostReturn = null;

/** PUT /nodes/{node}/subscription — form/query parameters (path segments omitted). */
export type NodesNodeSubscriptionPutParams = { key: string };
/** PUT /nodes/{node}/subscription — `data` payload after client unwrap. */
export type NodesNodeSubscriptionPutReturn = null;

/** DELETE /nodes/{node}/subscription — `data` payload after client unwrap. */
export type NodesNodeSubscriptionDeleteReturn = null;

/** GET /nodes/{node}/syslog — form/query parameters (path segments omitted). */
export type NodesNodeSyslogGetParams = {
  limit?: `${number}`;
  service?: string;
  since?: string;
  start?: `${number}`;
  until?: string;
};
/** GET /nodes/{node}/syslog — `data` payload after client unwrap. */
export type NodesNodeSyslogGetReturn = readonly { n: number; t: string }[];

/** GET /nodes/{node}/tasks — form/query parameters (path segments omitted). */
export type NodesNodeTasksGetParams = {
  errors?: '0' | '1';
  limit?: `${number}`;
  running?: '0' | '1';
  since?: `${number}`;
  start?: `${number}`;
  statusfilter?: readonly ('ok' | 'warning' | 'error' | 'unknown')[];
  store?: string;
  typefilter?: string;
  until?: `${number}`;
  userfilter?: string;
};
/** GET /nodes/{node}/tasks — `data` payload after client unwrap. */
export type NodesNodeTasksGetReturn = readonly {
  endtime?: number;
  node: string;
  pid: number;
  pstart: number;
  starttime: number;
  status?: string;
  upid: string;
  user: string;
  worker_id?: string;
  worker_type: string;
}[];

/** GET /nodes/{node}/tasks/{upid} — `data` payload after client unwrap. */
export type NodesNodeTasksUpidGetReturn = null;

/** DELETE /nodes/{node}/tasks/{upid} — `data` payload after client unwrap. */
export type NodesNodeTasksUpidDeleteReturn = null;

/** GET /nodes/{node}/tasks/{upid}/log — form/query parameters (path segments omitted). */
export type NodesNodeTasksUpidLogGetParams = {
  download?: '0' | '1';
  limit?: `${number}`;
  start?: `${number}`;
  'test-status'?: '0' | '1';
};
/** GET /nodes/{node}/tasks/{upid}/log — `data` payload after client unwrap. */
export type NodesNodeTasksUpidLogGetReturn = null;

/** GET /nodes/{node}/tasks/{upid}/status — `data` payload after client unwrap. */
export type NodesNodeTasksUpidStatusGetReturn = {
  endtime?: number;
  exitstatus?: string;
  id?: string;
  node: string;
  pid: number;
  pstart: number;
  starttime: number;
  status: string;
  tokenid?: string;
  type: string;
  upid: string;
  user: string;
};

/** POST /nodes/{node}/termproxy — form/query parameters (path segments omitted). */
export type NodesNodeTermproxyPostParams = { cmd?: 'login' | 'upgrade' };
/** POST /nodes/{node}/termproxy — `data` payload after client unwrap. */
export type NodesNodeTermproxyPostReturn = {
  port: number;
  ticket: string;
  upid: string;
  user: string;
};

/** GET /nodes/{node}/time — `data` payload after client unwrap. */
export type NodesNodeTimeGetReturn = { localtime: number; time: number; timezone: string };

/** PUT /nodes/{node}/time — form/query parameters (path segments omitted). */
export type NodesNodeTimePutParams = { timezone: string };
/** PUT /nodes/{node}/time — `data` payload after client unwrap. */
export type NodesNodeTimePutReturn = null;

/** GET /nodes/{node}/vncwebsocket — form/query parameters (path segments omitted). */
export type NodesNodeVncwebsocketGetParams = { port: `${number}`; vncticket: string };
/** GET /nodes/{node}/vncwebsocket — `data` payload after client unwrap. */
export type NodesNodeVncwebsocketGetReturn = null;
