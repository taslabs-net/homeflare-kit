/**
 * Generated pve-manager API types for `/nodes/node/services` — DO NOT EDIT BY HAND.
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

/** GET /nodes/{node}/services — `data` payload after client unwrap. */
export type NodesNodeServicesGetReturn = readonly ({
  'active-state':
    | 'active'
    | 'inactive'
    | 'failed'
    | 'activating'
    | 'deactivating'
    | 'maintenance'
    | 'reloading'
    | 'refreshing'
    | 'unknown';
  desc: string;
  name: string;
  service: string;
  state:
    | 'dead'
    | 'condition'
    | 'start-pre'
    | 'start'
    | 'start-post'
    | 'running'
    | 'exited'
    | 'reload'
    | 'reload-signal'
    | 'reload-notify'
    | 'mounting'
    | 'stop'
    | 'stop-watchdog'
    | 'stop-sigterm'
    | 'stop-sigkill'
    | 'stop-post'
    | 'final-watchdog'
    | 'final-sigterm'
    | 'final-sigkill'
    | 'failed'
    | 'dead-before-auto-restart'
    | 'failed-before-auto-restart'
    | 'dead-resources-pinned'
    | 'auto-restart'
    | 'auto-restart-queued'
    | 'cleaning'
    | 'unknown';
  'unit-state':
    | 'enabled'
    | 'enabled-runtime'
    | 'linked'
    | 'linked-runtime'
    | 'alias'
    | 'masked'
    | 'masked-runtime'
    | 'static'
    | 'disabled'
    | 'indirect'
    | 'generated'
    | 'transient'
    | 'bad'
    | 'not-found'
    | 'unknown';
} & Record<string, unknown>)[];

/** GET /nodes/{node}/services/{service} — `data` payload after client unwrap. */
export type NodesNodeServicesServiceGetReturn = readonly ({
  subdir: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/services/{service}/state — `data` payload after client unwrap. */
export type NodesNodeServicesServiceStateGetReturn = {
  'active-state':
    | 'active'
    | 'inactive'
    | 'failed'
    | 'activating'
    | 'deactivating'
    | 'maintenance'
    | 'reloading'
    | 'refreshing'
    | 'unknown';
  desc: string;
  name: string;
  service: string;
  state:
    | 'dead'
    | 'condition'
    | 'start-pre'
    | 'start'
    | 'start-post'
    | 'running'
    | 'exited'
    | 'reload'
    | 'reload-signal'
    | 'reload-notify'
    | 'mounting'
    | 'stop'
    | 'stop-watchdog'
    | 'stop-sigterm'
    | 'stop-sigkill'
    | 'stop-post'
    | 'final-watchdog'
    | 'final-sigterm'
    | 'final-sigkill'
    | 'failed'
    | 'dead-before-auto-restart'
    | 'failed-before-auto-restart'
    | 'dead-resources-pinned'
    | 'auto-restart'
    | 'auto-restart-queued'
    | 'cleaning'
    | 'unknown';
  'unit-state':
    | 'enabled'
    | 'enabled-runtime'
    | 'linked'
    | 'linked-runtime'
    | 'alias'
    | 'masked'
    | 'masked-runtime'
    | 'static'
    | 'disabled'
    | 'indirect'
    | 'generated'
    | 'transient'
    | 'bad'
    | 'not-found'
    | 'unknown';
} & Record<string, unknown>;

/** POST /nodes/{node}/services/{service}/start — `data` payload after client unwrap. */
export type NodesNodeServicesServiceStartPostReturn = string;

/** POST /nodes/{node}/services/{service}/stop — `data` payload after client unwrap. */
export type NodesNodeServicesServiceStopPostReturn = string;

/** POST /nodes/{node}/services/{service}/restart — `data` payload after client unwrap. */
export type NodesNodeServicesServiceRestartPostReturn = string;

/** POST /nodes/{node}/services/{service}/reload — `data` payload after client unwrap. */
export type NodesNodeServicesServiceReloadPostReturn = string;

/** POST /nodes/{node}/spiceshell — form/query parameters (path segments omitted). */
export type NodesNodeSpiceshellPostParams = {
  cmd?: 'ceph_install' | 'login' | 'upgrade';
  'cmd-opts'?: string;
  proxy?: string;
};
/** POST /nodes/{node}/spiceshell — `data` payload after client unwrap. */
export type NodesNodeSpiceshellPostReturn = {
  host: string;
  password: string;
  proxy: string;
  'tls-port': number;
  type: string;
} & Record<string, unknown>;

/** POST /nodes/{node}/startall — form/query parameters (path segments omitted). */
export type NodesNodeStartallPostParams = {
  force?: '0' | '1';
  'max-workers'?: `${number}`;
  vms?: string;
};
/** POST /nodes/{node}/startall — `data` payload after client unwrap. */
export type NodesNodeStartallPostReturn = string;

/** GET /nodes/{node}/status — `data` payload after client unwrap. */
export type NodesNodeStatusGetReturn = {
  'boot-info': {
    mode: 'efi' | 'legacy-bios';
    secureboot?: boolean | 0 | 1;
  } & Record<string, unknown>;
  cpu: number;
  cpuinfo: {
    cores: number;
    cpus: number;
    model: string;
    sockets: number;
  } & Record<string, unknown>;
  'current-kernel': {
    machine: string;
    release: string;
    sysname: string;
    version: string;
  } & Record<string, unknown>;
  loadavg: readonly string[];
  memory: {
    available: number;
    free: number;
    total: number;
    used: number;
  } & Record<string, unknown>;
  pveversion: string;
  rootfs: { avail: number; free: number; total: number; used: number } & Record<string, unknown>;
} & Record<string, unknown>;

/** POST /nodes/{node}/status — form/query parameters (path segments omitted). */
export type NodesNodeStatusPostParams = { command: 'reboot' | 'shutdown' };
/** POST /nodes/{node}/status — `data` payload after client unwrap. */
export type NodesNodeStatusPostReturn = null;

/** POST /nodes/{node}/stopall — form/query parameters (path segments omitted). */
export type NodesNodeStopallPostParams = {
  'force-stop'?: '0' | '1';
  'max-workers'?: `${number}`;
  timeout?: `${number}`;
  vms?: string;
};
/** POST /nodes/{node}/stopall — `data` payload after client unwrap. */
export type NodesNodeStopallPostReturn = string;
