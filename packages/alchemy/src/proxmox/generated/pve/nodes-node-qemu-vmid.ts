/**
 * Generated pve-manager API types for `/nodes/node/qemu/vmid` — DO NOT EDIT BY HAND.
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

/** GET /nodes/{node}/qemu/{vmid}/agent — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentGetReturn = readonly Record<string, unknown>[];

/** POST /nodes/{node}/qemu/{vmid}/agent — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidAgentPostParams = {
  command:
    | 'fsfreeze-freeze'
    | 'fsfreeze-status'
    | 'fsfreeze-thaw'
    | 'fstrim'
    | 'get-fsinfo'
    | 'get-host-name'
    | 'get-memory-block-info'
    | 'get-memory-blocks'
    | 'get-osinfo'
    | 'get-time'
    | 'get-timezone'
    | 'get-users'
    | 'get-vcpus'
    | 'info'
    | 'network-get-interfaces'
    | 'ping'
    | 'shutdown'
    | 'suspend-disk'
    | 'suspend-hybrid'
    | 'suspend-ram';
};
/** POST /nodes/{node}/qemu/{vmid}/agent — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentPostReturn = unknown;

/** POST /nodes/{node}/qemu/{vmid}/agent/fsfreeze-freeze — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentFsfreezeFreezePostReturn = unknown;

/** POST /nodes/{node}/qemu/{vmid}/agent/fsfreeze-status — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentFsfreezeStatusPostReturn = unknown;

/** POST /nodes/{node}/qemu/{vmid}/agent/fsfreeze-thaw — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentFsfreezeThawPostReturn = unknown;

/** POST /nodes/{node}/qemu/{vmid}/agent/fstrim — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentFstrimPostReturn = unknown;

/** GET /nodes/{node}/qemu/{vmid}/agent/get-fsinfo — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentGetFsinfoGetReturn = unknown;

/** GET /nodes/{node}/qemu/{vmid}/agent/get-host-name — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentGetHostNameGetReturn = unknown;

/** GET /nodes/{node}/qemu/{vmid}/agent/get-memory-block-info — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentGetMemoryBlockInfoGetReturn = unknown;

/** GET /nodes/{node}/qemu/{vmid}/agent/get-memory-blocks — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentGetMemoryBlocksGetReturn = unknown;

/** GET /nodes/{node}/qemu/{vmid}/agent/get-osinfo — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentGetOsinfoGetReturn = unknown;

/** GET /nodes/{node}/qemu/{vmid}/agent/get-time — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentGetTimeGetReturn = unknown;

/** GET /nodes/{node}/qemu/{vmid}/agent/get-timezone — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentGetTimezoneGetReturn = unknown;

/** GET /nodes/{node}/qemu/{vmid}/agent/get-users — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentGetUsersGetReturn = unknown;

/** GET /nodes/{node}/qemu/{vmid}/agent/get-vcpus — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentGetVcpusGetReturn = unknown;

/** GET /nodes/{node}/qemu/{vmid}/agent/info — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentInfoGetReturn = unknown;

/** GET /nodes/{node}/qemu/{vmid}/agent/network-get-interfaces — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentNetworkGetInterfacesGetReturn = unknown;

/** POST /nodes/{node}/qemu/{vmid}/agent/ping — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentPingPostReturn = unknown;

/** POST /nodes/{node}/qemu/{vmid}/agent/shutdown — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentShutdownPostReturn = unknown;

/** POST /nodes/{node}/qemu/{vmid}/agent/suspend-disk — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentSuspendDiskPostReturn = unknown;

/** POST /nodes/{node}/qemu/{vmid}/agent/suspend-hybrid — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentSuspendHybridPostReturn = unknown;

/** POST /nodes/{node}/qemu/{vmid}/agent/suspend-ram — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentSuspendRamPostReturn = unknown;

/** POST /nodes/{node}/qemu/{vmid}/agent/set-user-password — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidAgentSetUserPasswordPostParams = {
  crypted?: '0' | '1';
  password: string;
  username: string;
};
/** POST /nodes/{node}/qemu/{vmid}/agent/set-user-password — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentSetUserPasswordPostReturn = unknown;

/** POST /nodes/{node}/qemu/{vmid}/agent/exec — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidAgentExecPostParams = {
  command: readonly string[];
  'input-data'?: string;
};
/** POST /nodes/{node}/qemu/{vmid}/agent/exec — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentExecPostReturn = { pid: number } & Record<string, unknown>;

/** GET /nodes/{node}/qemu/{vmid}/agent/exec-status — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidAgentExecStatusGetParams = { pid: `${number}` };
/** GET /nodes/{node}/qemu/{vmid}/agent/exec-status — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentExecStatusGetReturn = {
  'err-data'?: string;
  'err-truncated'?: boolean | 0 | 1;
  exitcode?: number;
  exited: boolean | 0 | 1;
  'out-data'?: string;
  'out-truncated'?: boolean | 0 | 1;
  signal?: number;
} & Record<string, unknown>;

/** GET /nodes/{node}/qemu/{vmid}/agent/file-read — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidAgentFileReadGetParams = {
  count?: `${number}`;
  decode?: '0' | '1';
  file: string;
  offset?: `${number}`;
};
/** GET /nodes/{node}/qemu/{vmid}/agent/file-read — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentFileReadGetReturn = {
  content: string;
  truncated?: boolean | 0 | 1;
} & Record<string, unknown>;

/** POST /nodes/{node}/qemu/{vmid}/agent/file-write — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidAgentFileWritePostParams = {
  content: string;
  encode?: '0' | '1';
  file: string;
};
/** POST /nodes/{node}/qemu/{vmid}/agent/file-write — `data` payload after client unwrap. */
export type NodesNodeQemuVmidAgentFileWritePostReturn = null;

/** POST /nodes/{node}/qemu/{vmid}/clone — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidClonePostParams = {
  bwlimit?: `${number}`;
  description?: string;
  format?: 'raw' | 'qcow2' | 'vmdk';
  full?: '0' | '1';
  name?: string;
  newid: `${number}`;
  pool?: string;
  snapname?: string;
  storage?: string;
  target?: string;
};
/** POST /nodes/{node}/qemu/{vmid}/clone — `data` payload after client unwrap. */
export type NodesNodeQemuVmidClonePostReturn = string;

/** GET /nodes/{node}/qemu/{vmid}/cloudinit — `data` payload after client unwrap. */
export type NodesNodeQemuVmidCloudinitGetReturn = readonly ({
  delete?: number;
  key: string;
  pending?: string;
  value?: string;
} & Record<string, unknown>)[];

/** PUT /nodes/{node}/qemu/{vmid}/cloudinit — `data` payload after client unwrap. */
export type NodesNodeQemuVmidCloudinitPutReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/cloudinit/dump — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidCloudinitDumpGetParams = { type: 'user' | 'network' | 'meta' };
/** GET /nodes/{node}/qemu/{vmid}/cloudinit/dump — `data` payload after client unwrap. */
export type NodesNodeQemuVmidCloudinitDumpGetReturn = string;
