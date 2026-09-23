/**
 * Generated pve-manager API types for `/nodes/node/subscription` — DO NOT EDIT BY HAND.
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

/** GET /nodes/{node}/subscription — `data` payload after client unwrap. */
export type NodesNodeSubscriptionGetReturn = {
  checktime?: number;
  key?: string;
  level?: string;
  message?: string;
  nextduedate?: string;
  productname?: string;
  regdate?: string;
  serverid?: string;
  signature?: string;
  sockets?: number;
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

/** POST /nodes/{node}/suspendall — form/query parameters (path segments omitted). */
export type NodesNodeSuspendallPostParams = { 'max-workers'?: `${number}`; vms?: string };
/** POST /nodes/{node}/suspendall — `data` payload after client unwrap. */
export type NodesNodeSuspendallPostReturn = string;

/** GET /nodes/{node}/syslog — form/query parameters (path segments omitted). */
export type NodesNodeSyslogGetParams = {
  limit?: `${number}`;
  service?: string;
  since?: string;
  start?: `${number}`;
  until?: string;
};
/** GET /nodes/{node}/syslog — `data` payload after client unwrap. */
export type NodesNodeSyslogGetReturn = readonly ({ n: number; t: string } & Record<string, unknown>)[];

/** GET /nodes/{node}/tasks — form/query parameters (path segments omitted). */
export type NodesNodeTasksGetParams = {
  errors?: '0' | '1';
  limit?: `${number}`;
  since?: `${number}`;
  source?: 'archive' | 'active' | 'all';
  start?: `${number}`;
  statusfilter?: string;
  typefilter?: string;
  until?: `${number}`;
  userfilter?: string;
  vmid?: `${number}`;
};
/** GET /nodes/{node}/tasks — `data` payload after client unwrap. */
export type NodesNodeTasksGetReturn = readonly ({
  endtime?: number;
  id: string;
  node: string;
  pid: number;
  pstart: number;
  starttime: number;
  status?: string;
  type: string;
  upid: string;
  user: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/tasks/{upid} — `data` payload after client unwrap. */
export type NodesNodeTasksUpidGetReturn = readonly Record<string, unknown>[];

/** DELETE /nodes/{node}/tasks/{upid} — `data` payload after client unwrap. */
export type NodesNodeTasksUpidDeleteReturn = null;

/** GET /nodes/{node}/tasks/{upid}/log — form/query parameters (path segments omitted). */
export type NodesNodeTasksUpidLogGetParams = {
  download?: '0' | '1';
  limit?: `${number}`;
  start?: `${number}`;
};
/** GET /nodes/{node}/tasks/{upid}/log — `data` payload after client unwrap. */
export type NodesNodeTasksUpidLogGetReturn = readonly ({
  n: number;
  t: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/tasks/{upid}/status — `data` payload after client unwrap. */
export type NodesNodeTasksUpidStatusGetReturn = {
  exitstatus?: string;
  id: string;
  node: string;
  pid: number;
  pstart: number;
  starttime: number;
  status: 'running' | 'stopped';
  type: string;
  upid: string;
  user: string;
} & Record<string, unknown>;

/** POST /nodes/{node}/termproxy — form/query parameters (path segments omitted). */
export type NodesNodeTermproxyPostParams = {
  cmd?: 'ceph_install' | 'login' | 'upgrade';
  'cmd-opts'?: string;
};
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

/** GET /nodes/{node}/version — `data` payload after client unwrap. */
export type NodesNodeVersionGetReturn = {
  release: string;
  repoid: string;
  version: string;
} & Record<string, unknown>;

/** POST /nodes/{node}/vncshell — form/query parameters (path segments omitted). */
export type NodesNodeVncshellPostParams = {
  cmd?: 'ceph_install' | 'login' | 'upgrade';
  'cmd-opts'?: string;
  height?: `${number}`;
  websocket?: '0' | '1';
  width?: `${number}`;
};
/** POST /nodes/{node}/vncshell — `data` payload after client unwrap. */
export type NodesNodeVncshellPostReturn = {
  cert: string;
  password?: string;
  port: number;
  ticket: string;
  upid: string;
  user: string;
};

/** GET /nodes/{node}/vncwebsocket — form/query parameters (path segments omitted). */
export type NodesNodeVncwebsocketGetParams = { port: `${number}`; vncticket: string };
/** GET /nodes/{node}/vncwebsocket — `data` payload after client unwrap. */
export type NodesNodeVncwebsocketGetReturn = { port: string } & Record<string, unknown>;
