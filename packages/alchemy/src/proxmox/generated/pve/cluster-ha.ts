/**
 * Generated pve-manager API types for `/cluster/ha` — DO NOT EDIT BY HAND.
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

/** GET /cluster/ha — `data` payload after client unwrap. */
export type ClusterHaGetReturn = readonly ({ id: string } & Record<string, unknown>)[];

/** GET /cluster/ha/resources — form/query parameters (path segments omitted). */
export type ClusterHaResourcesGetParams = { type?: 'ct' | 'vm' };
/** GET /cluster/ha/resources — `data` payload after client unwrap. */
export type ClusterHaResourcesGetReturn = readonly ({ sid: string } & Record<string, unknown>)[];

/** POST /cluster/ha/resources — form/query parameters (path segments omitted). */
export type ClusterHaResourcesPostParams = {
  'auto-rebalance'?: '0' | '1';
  comment?: string;
  failback?: '0' | '1';
  group?: string;
  max_relocate?: `${number}`;
  max_restart?: `${number}`;
  sid: string;
  state?: 'started' | 'stopped' | 'enabled' | 'disabled' | 'ignored';
  type?: 'ct' | 'vm';
};
/** POST /cluster/ha/resources — `data` payload after client unwrap. */
export type ClusterHaResourcesPostReturn = null;

/** GET /cluster/ha/resources/{sid} — `data` payload after client unwrap. */
export type ClusterHaResourcesSidGetReturn = {
  'auto-rebalance'?: boolean | 0 | 1;
  comment?: string;
  digest: string;
  failback?: boolean | 0 | 1;
  group?: string;
  max_relocate?: number;
  max_restart?: number;
  sid: string;
  state?: 'started' | 'stopped' | 'enabled' | 'disabled' | 'ignored';
  type: string;
} & Record<string, unknown>;

/** PUT /cluster/ha/resources/{sid} — form/query parameters (path segments omitted). */
export type ClusterHaResourcesSidPutParams = {
  'auto-rebalance'?: '0' | '1';
  comment?: string;
  delete?: string;
  digest?: string;
  failback?: '0' | '1';
  group?: string;
  max_relocate?: `${number}`;
  max_restart?: `${number}`;
  state?: 'started' | 'stopped' | 'enabled' | 'disabled' | 'ignored';
};
/** PUT /cluster/ha/resources/{sid} — `data` payload after client unwrap. */
export type ClusterHaResourcesSidPutReturn = null;

/** DELETE /cluster/ha/resources/{sid} — form/query parameters (path segments omitted). */
export type ClusterHaResourcesSidDeleteParams = { purge?: '0' | '1' };
/** DELETE /cluster/ha/resources/{sid} — `data` payload after client unwrap. */
export type ClusterHaResourcesSidDeleteReturn = null;

/** POST /cluster/ha/resources/{sid}/migrate — form/query parameters (path segments omitted). */
export type ClusterHaResourcesSidMigratePostParams = { node: string };
/** POST /cluster/ha/resources/{sid}/migrate — `data` payload after client unwrap. */
export type ClusterHaResourcesSidMigratePostReturn = {
  'blocking-resources'?: readonly ({
    cause: 'node-affinity' | 'resource-affinity';
    sid: string;
  } & Record<string, unknown>)[];
  'comigrated-resources'?: readonly unknown[];
  'requested-node': string;
  sid: string;
} & Record<string, unknown>;

/** POST /cluster/ha/resources/{sid}/relocate — form/query parameters (path segments omitted). */
export type ClusterHaResourcesSidRelocatePostParams = { node: string };
/** POST /cluster/ha/resources/{sid}/relocate — `data` payload after client unwrap. */
export type ClusterHaResourcesSidRelocatePostReturn = {
  'blocking-resources'?: readonly ({
    cause: 'node-affinity' | 'resource-affinity';
    sid: string;
  } & Record<string, unknown>)[];
  'comigrated-resources'?: readonly string[];
  'requested-node': string;
  sid: string;
} & Record<string, unknown>;

/** GET /cluster/ha/groups — `data` payload after client unwrap. */
export type ClusterHaGroupsGetReturn = readonly ({ group: string } & Record<string, unknown>)[];

/** POST /cluster/ha/groups — form/query parameters (path segments omitted). */
export type ClusterHaGroupsPostParams = {
  comment?: string;
  group: string;
  nodes: string;
  nofailback?: '0' | '1';
  restricted?: '0' | '1';
  type?: 'group';
};
/** POST /cluster/ha/groups — `data` payload after client unwrap. */
export type ClusterHaGroupsPostReturn = null;

/** GET /cluster/ha/groups/{group} — `data` payload after client unwrap. */
export type ClusterHaGroupsGroupGetReturn = unknown;

/** PUT /cluster/ha/groups/{group} — form/query parameters (path segments omitted). */
export type ClusterHaGroupsGroupPutParams = {
  comment?: string;
  delete?: string;
  digest?: string;
  nodes?: string;
  nofailback?: '0' | '1';
  restricted?: '0' | '1';
};
/** PUT /cluster/ha/groups/{group} — `data` payload after client unwrap. */
export type ClusterHaGroupsGroupPutReturn = null;

/** DELETE /cluster/ha/groups/{group} — `data` payload after client unwrap. */
export type ClusterHaGroupsGroupDeleteReturn = null;

/** GET /cluster/ha/rules — form/query parameters (path segments omitted). */
export type ClusterHaRulesGetParams = {
  resource?: string;
  type?: 'node-affinity' | 'resource-affinity';
};
/** GET /cluster/ha/rules — `data` payload after client unwrap. */
export type ClusterHaRulesGetReturn = readonly ({ rule: string } & Record<string, unknown>)[];

/** POST /cluster/ha/rules — form/query parameters (path segments omitted). */
export type ClusterHaRulesPostParams = {
  affinity?: 'positive' | 'negative';
  comment?: string;
  disable?: '0' | '1';
  resources: string;
  rule: string;
};
/** POST /cluster/ha/rules — `data` payload after client unwrap. */
export type ClusterHaRulesPostReturn = null;

/** GET /cluster/ha/rules/{rule} — `data` payload after client unwrap. */
export type ClusterHaRulesRuleGetReturn = {
  rule: string;
  type: 'node-affinity' | 'resource-affinity';
} & Record<string, unknown>;

/** PUT /cluster/ha/rules/{rule} — form/query parameters (path segments omitted). */
export type ClusterHaRulesRulePutParams = {
  affinity?: 'positive' | 'negative';
  comment?: string;
  delete?: string;
  digest?: string;
  disable?: '0' | '1';
  resources?: string;
};
/** PUT /cluster/ha/rules/{rule} — `data` payload after client unwrap. */
export type ClusterHaRulesRulePutReturn = null;

/** DELETE /cluster/ha/rules/{rule} — `data` payload after client unwrap. */
export type ClusterHaRulesRuleDeleteReturn = null;

/** GET /cluster/ha/status — `data` payload after client unwrap. */
export type ClusterHaStatusGetReturn = readonly Record<string, unknown>[];

/** GET /cluster/ha/status/current — `data` payload after client unwrap. */
export type ClusterHaStatusCurrentGetReturn = readonly ({
  'armed-state'?: 'armed' | 'standby' | 'disarming' | 'disarmed';
  'auto-rebalance'?: boolean | 0 | 1;
  crm_state?: string;
  failback?: boolean | 0 | 1;
  id: string;
  max_relocate?: number;
  max_restart?: number;
  node: string;
  quorate?: boolean | 0 | 1;
  request_state?: string;
  resource_mode?: 'freeze' | 'ignore';
  sid?: string;
  state?: string;
  status: string;
  timestamp?: number;
  type: 'quorum' | 'master' | 'lrm' | 'service' | 'fencing';
} & Record<string, unknown>)[];

/** GET /cluster/ha/status/manager_status — `data` payload after client unwrap. */
export type ClusterHaStatusManager_statusGetReturn = unknown;

/** POST /cluster/ha/status/disarm-ha — form/query parameters (path segments omitted). */
export type ClusterHaStatusDisarmHaPostParams = { 'resource-mode': 'freeze' | 'ignore' };
/** POST /cluster/ha/status/disarm-ha — `data` payload after client unwrap. */
export type ClusterHaStatusDisarmHaPostReturn = null;

/** POST /cluster/ha/status/arm-ha — `data` payload after client unwrap. */
export type ClusterHaStatusArmHaPostReturn = null;
