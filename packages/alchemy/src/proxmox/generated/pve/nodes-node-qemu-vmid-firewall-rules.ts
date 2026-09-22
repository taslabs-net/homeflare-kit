/**
 * Generated pve-manager API types for `/nodes/node/qemu/vmid/firewall/rules` — DO NOT EDIT BY HAND.
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

/** GET /nodes/{node}/qemu/{vmid}/firewall/rules — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallRulesGetReturn = readonly ({
  action: string;
  comment?: string;
  dest?: string;
  dport?: string;
  enable?: number;
  'icmp-type'?: string;
  iface?: string;
  ipversion?: number;
  log?: 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug' | 'nolog';
  macro?: string;
  pos: number;
  proto?: string;
  source?: string;
  sport?: string;
  type: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/qemu/{vmid}/firewall/rules — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallRulesPostParams = {
  action: string;
  comment?: string;
  dest?: string;
  digest?: string;
  dport?: string;
  enable?: `${number}`;
  'icmp-type'?: string;
  iface?: string;
  log?: 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug' | 'nolog';
  macro?: string;
  pos?: `${number}`;
  proto?: string;
  source?: string;
  sport?: string;
  type: 'in' | 'out' | 'forward' | 'group';
};
/** POST /nodes/{node}/qemu/{vmid}/firewall/rules — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallRulesPostReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/firewall/rules/{pos} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallRulesPosGetReturn = {
  action: string;
  comment?: string;
  dest?: string;
  dport?: string;
  enable?: number;
  'icmp-type'?: string;
  iface?: string;
  ipversion?: number;
  log?: 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug' | 'nolog';
  macro?: string;
  pos: number;
  proto?: string;
  source?: string;
  sport?: string;
  type: string;
} & Record<string, unknown>;

/** PUT /nodes/{node}/qemu/{vmid}/firewall/rules/{pos} — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallRulesPosPutParams = {
  action?: string;
  comment?: string;
  delete?: string;
  dest?: string;
  digest?: string;
  dport?: string;
  enable?: `${number}`;
  'icmp-type'?: string;
  iface?: string;
  log?: 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug' | 'nolog';
  macro?: string;
  moveto?: `${number}`;
  proto?: string;
  source?: string;
  sport?: string;
  type?: 'in' | 'out' | 'forward' | 'group';
};
/** PUT /nodes/{node}/qemu/{vmid}/firewall/rules/{pos} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallRulesPosPutReturn = null;

/** DELETE /nodes/{node}/qemu/{vmid}/firewall/rules/{pos} — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallRulesPosDeleteParams = { digest?: string };
/** DELETE /nodes/{node}/qemu/{vmid}/firewall/rules/{pos} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallRulesPosDeleteReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/migrate — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidMigrateGetParams = { target?: string };
/** GET /nodes/{node}/qemu/{vmid}/migrate — `data` payload after client unwrap. */
export type NodesNodeQemuVmidMigrateGetReturn = {
  allowed_nodes?: readonly string[];
  'dependent-ha-resources'?: readonly string[];
  'has-dbus-vmstate': boolean | 0 | 1;
  local_disks: readonly ({
    cdrom: boolean | 0 | 1;
    is_unused: boolean | 0 | 1;
    size: number;
    volid: string;
  } & Record<string, unknown>)[];
  local_resources: readonly string[];
  'mapped-resource-info': unknown;
  'mapped-resources': readonly string[];
  not_allowed_nodes?: {
    'blocking-ha-resources'?: readonly ({
      cause: 'node-affinity' | 'resource-affinity';
      sid: string;
    } & Record<string, unknown>)[];
    unavailable_storages?: readonly string[];
  } & Record<string, unknown>;
  running: boolean | 0 | 1;
} & Record<string, unknown>;

/** POST /nodes/{node}/qemu/{vmid}/migrate — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidMigratePostParams = {
  bwlimit?: `${number}`;
  force?: '0' | '1';
  migration_network?: string;
  migration_type?: 'secure' | 'insecure';
  online?: '0' | '1';
  target: string;
  targetstorage?: string;
  'with-conntrack-state'?: '0' | '1';
  'with-local-disks'?: '0' | '1';
};
/** POST /nodes/{node}/qemu/{vmid}/migrate — `data` payload after client unwrap. */
export type NodesNodeQemuVmidMigratePostReturn = string;

/** POST /nodes/{node}/qemu/{vmid}/monitor — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidMonitorPostParams = { command: string };
/** POST /nodes/{node}/qemu/{vmid}/monitor — `data` payload after client unwrap. */
export type NodesNodeQemuVmidMonitorPostReturn = string;
