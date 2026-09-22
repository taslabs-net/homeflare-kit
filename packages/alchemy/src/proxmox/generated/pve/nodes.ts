/**
 * Generated pve-manager API types for `/nodes` — DO NOT EDIT BY HAND.
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

/** GET /nodes — `data` payload after client unwrap. */
export type NodesGetReturn = readonly ({
  cpu?: number;
  level?: string;
  maxcpu?: number;
  maxmem?: number;
  mem?: number;
  node: string;
  ssl_fingerprint?: string;
  status: 'unknown' | 'online' | 'offline';
  uptime?: number;
} & Record<string, unknown>)[];

/** GET /nodes/{node} — `data` payload after client unwrap. */
export type NodesNodeGetReturn = readonly Record<string, unknown>[];

/** GET /nodes/{node}/aplinfo — `data` payload after client unwrap. */
export type NodesNodeAplinfoGetReturn = readonly Record<string, unknown>[];

/** POST /nodes/{node}/aplinfo — form/query parameters (path segments omitted). */
export type NodesNodeAplinfoPostParams = { storage: string; template: string };
/** POST /nodes/{node}/aplinfo — `data` payload after client unwrap. */
export type NodesNodeAplinfoPostReturn = string;

/** GET /nodes/{node}/apt — `data` payload after client unwrap. */
export type NodesNodeAptGetReturn = readonly ({ id: string } & Record<string, unknown>)[];

/** GET /nodes/{node}/apt/update — `data` payload after client unwrap. */
export type NodesNodeAptUpdateGetReturn = readonly ({
  Arch: 'armhf' | 'arm64' | 'amd64' | 'ppc64el' | 'risc64' | 's390x' | 'all';
  Description: string;
  NotifyStatus?: string;
  OldVersion?: string;
  Origin: string;
  Package: string;
  Priority: string;
  Section: string;
  Title: string;
  Version: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/apt/update — form/query parameters (path segments omitted). */
export type NodesNodeAptUpdatePostParams = { notify?: '0' | '1'; quiet?: '0' | '1' };
/** POST /nodes/{node}/apt/update — `data` payload after client unwrap. */
export type NodesNodeAptUpdatePostReturn = string;

/** GET /nodes/{node}/apt/changelog — form/query parameters (path segments omitted). */
export type NodesNodeAptChangelogGetParams = { name: string; version?: string };
/** GET /nodes/{node}/apt/changelog — `data` payload after client unwrap. */
export type NodesNodeAptChangelogGetReturn = string;

/** GET /nodes/{node}/apt/repositories — `data` payload after client unwrap. */
export type NodesNodeAptRepositoriesGetReturn = {
  digest: string;
  errors: readonly ({ error: string; path: string } & Record<string, unknown>)[];
  files: readonly ({
    digest: readonly number[];
    'file-type': 'list' | 'sources';
    path: string;
    repositories: readonly ({
      Comment?: string;
      Components?: readonly string[];
      Enabled: boolean | 0 | 1;
      FileType: 'list' | 'sources';
      Options?: readonly ({ Key: string; Values: readonly string[] } & Record<string, unknown>)[];
      Suites: readonly string[];
      Types: readonly ('deb' | 'deb-src')[];
      URIs: readonly string[];
    } & Record<string, unknown>)[];
  } & Record<string, unknown>)[];
  infos: readonly ({
    index: string;
    kind: string;
    message: string;
    path: string;
    property?: string;
  } & Record<string, unknown>)[];
  'standard-repos': readonly ({
    handle: string;
    name: string;
    status?: boolean | 0 | 1;
  } & Record<string, unknown>)[];
} & Record<string, unknown>;

/** POST /nodes/{node}/apt/repositories — form/query parameters (path segments omitted). */
export type NodesNodeAptRepositoriesPostParams = {
  digest?: string;
  enabled?: '0' | '1';
  index: `${number}`;
  path: string;
};
/** POST /nodes/{node}/apt/repositories — `data` payload after client unwrap. */
export type NodesNodeAptRepositoriesPostReturn = null;

/** PUT /nodes/{node}/apt/repositories — form/query parameters (path segments omitted). */
export type NodesNodeAptRepositoriesPutParams = { digest?: string; handle: string };
/** PUT /nodes/{node}/apt/repositories — `data` payload after client unwrap. */
export type NodesNodeAptRepositoriesPutReturn = null;

/** GET /nodes/{node}/apt/versions — `data` payload after client unwrap. */
export type NodesNodeAptVersionsGetReturn = readonly ({
  Arch: 'armhf' | 'arm64' | 'amd64' | 'ppc64el' | 'risc64' | 's390x' | 'all';
  CurrentState:
    | 'Installed'
    | 'NotInstalled'
    | 'UnPacked'
    | 'HalfConfigured'
    | 'HalfInstalled'
    | 'ConfigFiles';
  Description: string;
  ManagerVersion?: string;
  NotifyStatus?: string;
  OldVersion?: string;
  Origin: string;
  Package: string;
  Priority: string;
  RunningKernel?: string;
  Section: string;
  Title: string;
  Version: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/capabilities — `data` payload after client unwrap. */
export type NodesNodeCapabilitiesGetReturn = readonly Record<string, unknown>[];

/** GET /nodes/{node}/capabilities/qemu — `data` payload after client unwrap. */
export type NodesNodeCapabilitiesQemuGetReturn = readonly Record<string, unknown>[];

/** GET /nodes/{node}/capabilities/qemu/cpu — form/query parameters (path segments omitted). */
export type NodesNodeCapabilitiesQemuCpuGetParams = { arch?: 'x86_64' | 'aarch64' };
/** GET /nodes/{node}/capabilities/qemu/cpu — `data` payload after client unwrap. */
export type NodesNodeCapabilitiesQemuCpuGetReturn = readonly ({
  abstract?: boolean | 0 | 1;
  custom: boolean | 0 | 1;
  name: string;
  vendor: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/capabilities/qemu/cpu-flags — form/query parameters (path segments omitted). */
export type NodesNodeCapabilitiesQemuCpuFlagsGetParams = {
  accel?: 'kvm' | 'tcg';
  arch?: 'x86_64' | 'aarch64';
};
/** GET /nodes/{node}/capabilities/qemu/cpu-flags — `data` payload after client unwrap. */
export type NodesNodeCapabilitiesQemuCpuFlagsGetReturn = readonly ({
  description?: string;
  name: string;
  'supported-on'?: readonly string[];
} & Record<string, unknown>)[];

/** GET /nodes/{node}/capabilities/qemu/machines — form/query parameters (path segments omitted). */
export type NodesNodeCapabilitiesQemuMachinesGetParams = { arch?: 'x86_64' | 'aarch64' };
/** GET /nodes/{node}/capabilities/qemu/machines — `data` payload after client unwrap. */
export type NodesNodeCapabilitiesQemuMachinesGetReturn = readonly ({
  changes?: string;
  id: string;
  type: 'q35' | 'i440fx';
  version: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/capabilities/qemu/migration — `data` payload after client unwrap. */
export type NodesNodeCapabilitiesQemuMigrationGetReturn = { 'has-dbus-vmstate': boolean | 0 | 1 };

/** GET /nodes/{node}/ceph — `data` payload after client unwrap. */
export type NodesNodeCephGetReturn = readonly Record<string, unknown>[];

/** GET /nodes/{node}/ceph/cfg — `data` payload after client unwrap. */
export type NodesNodeCephCfgGetReturn = readonly Record<string, unknown>[];

/** GET /nodes/{node}/ceph/cfg/raw — `data` payload after client unwrap. */
export type NodesNodeCephCfgRawGetReturn = string;

/** GET /nodes/{node}/ceph/cfg/db — `data` payload after client unwrap. */
export type NodesNodeCephCfgDbGetReturn = readonly ({
  can_update_at_runtime: boolean | 0 | 1;
  level: 'basic' | 'advanced' | 'dev';
  mask: string;
  name: string;
  section: string;
  value: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/ceph/cfg/value — form/query parameters (path segments omitted). */
export type NodesNodeCephCfgValueGetParams = { 'config-keys': string };
/** GET /nodes/{node}/ceph/cfg/value — `data` payload after client unwrap. */
export type NodesNodeCephCfgValueGetReturn = unknown;

/** GET /nodes/{node}/ceph/cmd-safety — form/query parameters (path segments omitted). */
export type NodesNodeCephCmdSafetyGetParams = {
  action: 'stop' | 'destroy';
  id: string;
  service: 'osd' | 'mon' | 'mds';
};
/** GET /nodes/{node}/ceph/cmd-safety — `data` payload after client unwrap. */
export type NodesNodeCephCmdSafetyGetReturn = { safe: boolean | 0 | 1; status?: string };

/** GET /nodes/{node}/ceph/crush — `data` payload after client unwrap. */
export type NodesNodeCephCrushGetReturn = string;

/** GET /nodes/{node}/ceph/fs — `data` payload after client unwrap. */
export type NodesNodeCephFsGetReturn = readonly ({
  data_pool: string;
  data_pool_ids?: readonly number[];
  data_pools?: readonly string[];
  metadata_pool: string;
  metadata_pool_id?: number;
  name: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/ceph/fs/{name} — form/query parameters (path segments omitted). */
export type NodesNodeCephFsNamePostParams = { 'add-storage'?: '0' | '1'; pg_num?: `${number}` };
/** POST /nodes/{node}/ceph/fs/{name} — `data` payload after client unwrap. */
export type NodesNodeCephFsNamePostReturn = string;

/** DELETE /nodes/{node}/ceph/fs/{name} — form/query parameters (path segments omitted). */
export type NodesNodeCephFsNameDeleteParams = {
  'remove-pools'?: '0' | '1';
  'remove-storages'?: '0' | '1';
};
/** DELETE /nodes/{node}/ceph/fs/{name} — `data` payload after client unwrap. */
export type NodesNodeCephFsNameDeleteReturn = string;
