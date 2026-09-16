/**
 * Generated PVE API types — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/generate.ts
 * Source: house/proxmox/apidoc/ — see README there for provenance.
 */

/** GET /cluster/replication — `data` payload after client unwrap. */
export type ClusterReplicationGetReturn = readonly ({
  comment?: string;
  disable?: boolean | 0 | 1;
  guest: number;
  id: string;
  jobnum: number;
  rate?: number;
  remove_job?: 'local' | 'full';
  schedule?: string;
  source?: string;
  target: string;
  type: 'local';
} & Record<string, unknown>)[];

/** POST /cluster/replication — form/query parameters (path segments omitted). */
export type ClusterReplicationPostParams = {
  comment?: string;
  disable?: '0' | '1';
  id: string;
  rate?: string;
  remove_job?: 'local' | 'full';
  schedule?: string;
  source?: string;
  target: string;
  type: 'local';
};
/** POST /cluster/replication — `data` payload after client unwrap. */
export type ClusterReplicationPostReturn = null;

/** GET /cluster/replication/{id} — `data` payload after client unwrap. */
export type ClusterReplicationIdGetReturn = {
  comment?: string;
  digest?: string;
  disable?: boolean | 0 | 1;
  guest: number;
  id: string;
  jobnum: number;
  rate?: number;
  remove_job?: 'local' | 'full';
  schedule?: string;
  source?: string;
  target: string;
  type: 'local';
} & Record<string, unknown>;

/** PUT /cluster/replication/{id} — form/query parameters (path segments omitted). */
export type ClusterReplicationIdPutParams = {
  comment?: string;
  delete?: string;
  digest?: string;
  disable?: '0' | '1';
  rate?: string;
  remove_job?: 'local' | 'full';
  schedule?: string;
  source?: string;
};
/** PUT /cluster/replication/{id} — `data` payload after client unwrap. */
export type ClusterReplicationIdPutReturn = null;

/** DELETE /cluster/replication/{id} — form/query parameters (path segments omitted). */
export type ClusterReplicationIdDeleteParams = { force?: '0' | '1'; keep?: '0' | '1' };
/** DELETE /cluster/replication/{id} — `data` payload after client unwrap. */
export type ClusterReplicationIdDeleteReturn = null;

/** GET /cluster/metrics/server — `data` payload after client unwrap. */
export type ClusterMetricsServerGetReturn = readonly ({
  disable: boolean | 0 | 1;
  id: string;
  port: number;
  server: string;
  type: string;
} & Record<string, unknown>)[];

/** GET /cluster/metrics/server/{id} — `data` payload after client unwrap. */
export type ClusterMetricsServerIdGetReturn = unknown;

/** POST /cluster/metrics/server/{id} — form/query parameters (path segments omitted). */
export type ClusterMetricsServerIdPostParams = {
  'api-path-prefix'?: string;
  bucket?: string;
  disable?: '0' | '1';
  influxdbproto?: 'udp' | 'http' | 'https';
  'max-body-size'?: string;
  mtu?: string;
  organization?: string;
  'otel-compression'?: 'none' | 'gzip';
  'otel-headers'?: string;
  'otel-max-body-size'?: string;
  'otel-path'?: string;
  'otel-protocol'?: 'http' | 'https';
  'otel-resource-attributes'?: string;
  'otel-timeout'?: string;
  'otel-verify-ssl'?: '0' | '1';
  path?: string;
  port: string;
  proto?: 'udp' | 'tcp';
  server: string;
  timeout?: string;
  token?: string;
  type: 'graphite' | 'influxdb' | 'opentelemetry';
  'verify-certificate'?: '0' | '1';
};
/** POST /cluster/metrics/server/{id} — `data` payload after client unwrap. */
export type ClusterMetricsServerIdPostReturn = null;

/** PUT /cluster/metrics/server/{id} — form/query parameters (path segments omitted). */
export type ClusterMetricsServerIdPutParams = {
  'api-path-prefix'?: string;
  bucket?: string;
  delete?: string;
  digest?: string;
  disable?: '0' | '1';
  influxdbproto?: 'udp' | 'http' | 'https';
  'max-body-size'?: string;
  mtu?: string;
  organization?: string;
  'otel-compression'?: 'none' | 'gzip';
  'otel-headers'?: string;
  'otel-max-body-size'?: string;
  'otel-path'?: string;
  'otel-protocol'?: 'http' | 'https';
  'otel-resource-attributes'?: string;
  'otel-timeout'?: string;
  'otel-verify-ssl'?: '0' | '1';
  path?: string;
  port: string;
  proto?: 'udp' | 'tcp';
  server: string;
  timeout?: string;
  token?: string;
  'verify-certificate'?: '0' | '1';
};
/** PUT /cluster/metrics/server/{id} — `data` payload after client unwrap. */
export type ClusterMetricsServerIdPutReturn = null;

/** DELETE /cluster/metrics/server/{id} — `data` payload after client unwrap. */
export type ClusterMetricsServerIdDeleteReturn = null;

/** GET /cluster/notifications/endpoints — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsGetReturn = readonly Record<string, unknown>[];

/** GET /cluster/notifications/endpoints/sendmail — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSendmailGetReturn = readonly ({
  author?: string;
  comment?: string;
  disable?: boolean | 0 | 1;
  'from-address'?: string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  name: string;
  origin: 'user-created' | 'builtin' | 'modified-builtin';
} & Record<string, unknown>)[];

/** POST /cluster/notifications/endpoints/sendmail — form/query parameters (path segments omitted). */
export type ClusterNotificationsEndpointsSendmailPostParams = {
  author?: string;
  comment?: string;
  disable?: '0' | '1';
  'from-address'?: string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  name: string;
};
/** POST /cluster/notifications/endpoints/sendmail — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSendmailPostReturn = null;

/** GET /cluster/notifications/endpoints/sendmail/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSendmailNameGetReturn = {
  author?: string;
  comment?: string;
  digest?: string;
  disable?: boolean | 0 | 1;
  'from-address'?: string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  name: string;
} & Record<string, unknown>;

/** PUT /cluster/notifications/endpoints/sendmail/{name} — form/query parameters (path segments omitted). */
export type ClusterNotificationsEndpointsSendmailNamePutParams = {
  author?: string;
  comment?: string;
  delete?: readonly string[];
  digest?: string;
  disable?: '0' | '1';
  'from-address'?: string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
};
/** PUT /cluster/notifications/endpoints/sendmail/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSendmailNamePutReturn = null;

/** DELETE /cluster/notifications/endpoints/sendmail/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSendmailNameDeleteReturn = null;

/** GET /cluster/notifications/endpoints/gotify — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsGotifyGetReturn = readonly ({
  comment?: string;
  disable?: boolean | 0 | 1;
  name: string;
  origin: 'user-created' | 'builtin' | 'modified-builtin';
  server: string;
} & Record<string, unknown>)[];

/** POST /cluster/notifications/endpoints/gotify — form/query parameters (path segments omitted). */
export type ClusterNotificationsEndpointsGotifyPostParams = {
  comment?: string;
  disable?: '0' | '1';
  name: string;
  server: string;
  token: string;
};
/** POST /cluster/notifications/endpoints/gotify — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsGotifyPostReturn = null;

/** GET /cluster/notifications/endpoints/gotify/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsGotifyNameGetReturn = {
  comment?: string;
  digest?: string;
  disable?: boolean | 0 | 1;
  name: string;
  server: string;
} & Record<string, unknown>;

/** PUT /cluster/notifications/endpoints/gotify/{name} — form/query parameters (path segments omitted). */
export type ClusterNotificationsEndpointsGotifyNamePutParams = {
  comment?: string;
  delete?: readonly string[];
  digest?: string;
  disable?: '0' | '1';
  server?: string;
  token?: string;
};
/** PUT /cluster/notifications/endpoints/gotify/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsGotifyNamePutReturn = null;

/** DELETE /cluster/notifications/endpoints/gotify/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsGotifyNameDeleteReturn = null;

/** GET /cluster/notifications/endpoints/smtp — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSmtpGetReturn = readonly ({
  author?: string;
  comment?: string;
  disable?: boolean | 0 | 1;
  'from-address': string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  mode?: 'insecure' | 'starttls' | 'tls';
  name: string;
  origin: 'user-created' | 'builtin' | 'modified-builtin';
  port?: number;
  server: string;
  username?: string;
} & Record<string, unknown>)[];

/** POST /cluster/notifications/endpoints/smtp — form/query parameters (path segments omitted). */
export type ClusterNotificationsEndpointsSmtpPostParams = {
  author?: string;
  comment?: string;
  disable?: '0' | '1';
  'from-address': string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  mode?: 'insecure' | 'starttls' | 'tls';
  name: string;
  password?: string;
  port?: string;
  server: string;
  username?: string;
};
/** POST /cluster/notifications/endpoints/smtp — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSmtpPostReturn = null;

/** GET /cluster/notifications/endpoints/smtp/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSmtpNameGetReturn = {
  author?: string;
  comment?: string;
  digest?: string;
  disable?: boolean | 0 | 1;
  'from-address': string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  mode?: 'insecure' | 'starttls' | 'tls';
  name: string;
  port?: number;
  server: string;
  username?: string;
} & Record<string, unknown>;

/** PUT /cluster/notifications/endpoints/smtp/{name} — form/query parameters (path segments omitted). */
export type ClusterNotificationsEndpointsSmtpNamePutParams = {
  author?: string;
  comment?: string;
  delete?: readonly string[];
  digest?: string;
  disable?: '0' | '1';
  'from-address'?: string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  mode?: 'insecure' | 'starttls' | 'tls';
  password?: string;
  port?: string;
  server?: string;
  username?: string;
};
/** PUT /cluster/notifications/endpoints/smtp/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSmtpNamePutReturn = null;

/** DELETE /cluster/notifications/endpoints/smtp/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSmtpNameDeleteReturn = null;

/** GET /cluster/notifications/endpoints/webhook — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsWebhookGetReturn = readonly ({
  body?: string;
  comment?: string;
  disable?: boolean | 0 | 1;
  header?: readonly string[];
  method: 'post' | 'put' | 'get';
  name: string;
  origin: 'user-created' | 'builtin' | 'modified-builtin';
  secret?: readonly string[];
  url: string;
} & Record<string, unknown>)[];

/** POST /cluster/notifications/endpoints/webhook — form/query parameters (path segments omitted). */
export type ClusterNotificationsEndpointsWebhookPostParams = {
  body?: string;
  comment?: string;
  disable?: '0' | '1';
  header?: readonly string[];
  method: 'post' | 'put' | 'get';
  name: string;
  secret?: readonly string[];
  url: string;
};
/** POST /cluster/notifications/endpoints/webhook — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsWebhookPostReturn = null;

/** GET /cluster/notifications/endpoints/webhook/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsWebhookNameGetReturn = {
  body?: string;
  comment?: string;
  digest?: string;
  disable?: boolean | 0 | 1;
  header?: readonly string[];
  method: 'post' | 'put' | 'get';
  name: string;
  secret?: readonly string[];
  url: string;
} & Record<string, unknown>;

/** PUT /cluster/notifications/endpoints/webhook/{name} — form/query parameters (path segments omitted). */
export type ClusterNotificationsEndpointsWebhookNamePutParams = {
  body?: string;
  comment?: string;
  delete?: readonly string[];
  digest?: string;
  disable?: '0' | '1';
  header?: readonly string[];
  method?: 'post' | 'put' | 'get';
  secret?: readonly string[];
  url?: string;
};
/** PUT /cluster/notifications/endpoints/webhook/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsWebhookNamePutReturn = null;

/** DELETE /cluster/notifications/endpoints/webhook/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsWebhookNameDeleteReturn = null;

/** GET /cluster/firewall/aliases — `data` payload after client unwrap. */
export type ClusterFirewallAliasesGetReturn = readonly ({
  cidr: string;
  comment?: string;
  digest: string;
  name: string;
} & Record<string, unknown>)[];

/** POST /cluster/firewall/aliases — form/query parameters (path segments omitted). */
export type ClusterFirewallAliasesPostParams = { cidr: string; comment?: string; name: string };
/** POST /cluster/firewall/aliases — `data` payload after client unwrap. */
export type ClusterFirewallAliasesPostReturn = null;

/** GET /cluster/firewall/aliases/{name} — `data` payload after client unwrap. */
export type ClusterFirewallAliasesNameGetReturn = unknown;

/** PUT /cluster/firewall/aliases/{name} — form/query parameters (path segments omitted). */
export type ClusterFirewallAliasesNamePutParams = {
  cidr: string;
  comment?: string;
  digest?: string;
  rename?: string;
};
/** PUT /cluster/firewall/aliases/{name} — `data` payload after client unwrap. */
export type ClusterFirewallAliasesNamePutReturn = null;

/** DELETE /cluster/firewall/aliases/{name} — form/query parameters (path segments omitted). */
export type ClusterFirewallAliasesNameDeleteParams = { digest?: string };
/** DELETE /cluster/firewall/aliases/{name} — `data` payload after client unwrap. */
export type ClusterFirewallAliasesNameDeleteReturn = null;

/** GET /cluster/backup — `data` payload after client unwrap. */
export type ClusterBackupGetReturn = readonly ({
  all?: boolean | 0 | 1;
  bwlimit?: number;
  comment?: string;
  compress?: '0' | '1' | 'gzip' | 'lzo' | 'zstd';
  dumpdir?: string;
  enabled?: boolean | 0 | 1;
  exclude?: string;
  'exclude-path'?: readonly string[];
  fleecing?: { enabled?: boolean | 0 | 1; storage?: string } & Record<string, unknown>;
  id: string;
  ionice?: number;
  lockwait?: number;
  mailnotification?: 'always' | 'failure';
  mailto?: string;
  mode?: 'snapshot' | 'suspend' | 'stop';
  'next-run'?: number;
  node?: string;
  'notes-template'?: string;
  'notification-mode'?: 'auto' | 'legacy-sendmail' | 'notification-system';
  'pbs-change-detection-mode'?: 'legacy' | 'data' | 'metadata';
  performance?: { 'max-workers'?: number; 'pbs-entries-max'?: number } & Record<string, unknown>;
  pigz?: number;
  pool?: string;
  protected?: boolean | 0 | 1;
  'prune-backups'?: {
    'keep-all'?: boolean | 0 | 1;
    'keep-daily'?: number;
    'keep-hourly'?: number;
    'keep-last'?: number;
    'keep-monthly'?: number;
    'keep-weekly'?: number;
    'keep-yearly'?: number;
  } & Record<string, unknown>;
  quiet?: boolean | 0 | 1;
  remove?: boolean | 0 | 1;
  'repeat-missed'?: boolean | 0 | 1;
  schedule?: string;
  script?: string;
  stdexcludes?: boolean | 0 | 1;
  stop?: boolean | 0 | 1;
  stopwait?: number;
  storage?: string;
  tmpdir?: string;
  vmid?: string;
  zstd?: number;
} & Record<string, unknown>)[];

/** POST /cluster/backup — form/query parameters (path segments omitted). */
export type ClusterBackupPostParams = {
  all?: '0' | '1';
  bwlimit?: string;
  comment?: string;
  compress?: '0' | '1' | 'gzip' | 'lzo' | 'zstd';
  dow?: string;
  dumpdir?: string;
  enabled?: '0' | '1';
  exclude?: string;
  'exclude-path'?: readonly string[];
  fleecing?: string;
  id?: string;
  ionice?: string;
  lockwait?: string;
  mailnotification?: 'always' | 'failure';
  mailto?: string;
  mode?: 'snapshot' | 'suspend' | 'stop';
  node?: string;
  'notes-template'?: string;
  'notification-mode'?: 'auto' | 'legacy-sendmail' | 'notification-system';
  'pbs-change-detection-mode'?: 'legacy' | 'data' | 'metadata';
  performance?: string;
  pigz?: string;
  pool?: string;
  protected?: '0' | '1';
  'prune-backups'?: string;
  quiet?: '0' | '1';
  remove?: '0' | '1';
  'repeat-missed'?: '0' | '1';
  schedule?: string;
  script?: string;
  starttime?: string;
  stdexcludes?: '0' | '1';
  stop?: '0' | '1';
  stopwait?: string;
  storage?: string;
  tmpdir?: string;
  vmid?: string;
  zstd?: string;
};
/** POST /cluster/backup — `data` payload after client unwrap. */
export type ClusterBackupPostReturn = null;

/** GET /cluster/backup/{id} — `data` payload after client unwrap. */
export type ClusterBackupIdGetReturn = {
  all?: boolean | 0 | 1;
  bwlimit?: number;
  comment?: string;
  compress?: '0' | '1' | 'gzip' | 'lzo' | 'zstd';
  dumpdir?: string;
  enabled?: boolean | 0 | 1;
  exclude?: string;
  'exclude-path'?: readonly string[];
  fleecing?: { enabled?: boolean | 0 | 1; storage?: string } & Record<string, unknown>;
  id: string;
  ionice?: number;
  lockwait?: number;
  mailnotification?: 'always' | 'failure';
  mailto?: string;
  mode?: 'snapshot' | 'suspend' | 'stop';
  'next-run'?: number;
  node?: string;
  'notes-template'?: string;
  'notification-mode'?: 'auto' | 'legacy-sendmail' | 'notification-system';
  'pbs-change-detection-mode'?: 'legacy' | 'data' | 'metadata';
  performance?: { 'max-workers'?: number; 'pbs-entries-max'?: number } & Record<string, unknown>;
  pigz?: number;
  pool?: string;
  protected?: boolean | 0 | 1;
  'prune-backups'?: {
    'keep-all'?: boolean | 0 | 1;
    'keep-daily'?: number;
    'keep-hourly'?: number;
    'keep-last'?: number;
    'keep-monthly'?: number;
    'keep-weekly'?: number;
    'keep-yearly'?: number;
  } & Record<string, unknown>;
  quiet?: boolean | 0 | 1;
  remove?: boolean | 0 | 1;
  'repeat-missed'?: boolean | 0 | 1;
  schedule?: string;
  script?: string;
  stdexcludes?: boolean | 0 | 1;
  stop?: boolean | 0 | 1;
  stopwait?: number;
  storage?: string;
  tmpdir?: string;
  vmid?: string;
  zstd?: number;
} & Record<string, unknown>;

/** PUT /cluster/backup/{id} — form/query parameters (path segments omitted). */
export type ClusterBackupIdPutParams = {
  all?: '0' | '1';
  bwlimit?: string;
  comment?: string;
  compress?: '0' | '1' | 'gzip' | 'lzo' | 'zstd';
  delete?: string;
  dow?: string;
  dumpdir?: string;
  enabled?: '0' | '1';
  exclude?: string;
  'exclude-path'?: readonly string[];
  fleecing?: string;
  ionice?: string;
  lockwait?: string;
  mailnotification?: 'always' | 'failure';
  mailto?: string;
  mode?: 'snapshot' | 'suspend' | 'stop';
  node?: string;
  'notes-template'?: string;
  'notification-mode'?: 'auto' | 'legacy-sendmail' | 'notification-system';
  'pbs-change-detection-mode'?: 'legacy' | 'data' | 'metadata';
  performance?: string;
  pigz?: string;
  pool?: string;
  protected?: '0' | '1';
  'prune-backups'?: string;
  quiet?: '0' | '1';
  remove?: '0' | '1';
  'repeat-missed'?: '0' | '1';
  schedule?: string;
  script?: string;
  starttime?: string;
  stdexcludes?: '0' | '1';
  stop?: '0' | '1';
  stopwait?: string;
  storage?: string;
  tmpdir?: string;
  vmid?: string;
  zstd?: string;
};
/** PUT /cluster/backup/{id} — `data` payload after client unwrap. */
export type ClusterBackupIdPutReturn = null;

/** DELETE /cluster/backup/{id} — `data` payload after client unwrap. */
export type ClusterBackupIdDeleteReturn = null;

/** GET /cluster/backup/{id}/included_volumes — `data` payload after client unwrap. */
export type ClusterBackupIdIncluded_volumesGetReturn = {
  children: readonly ({
    children?: readonly ({
      id: string;
      included: boolean | 0 | 1;
      name: string;
      reason: string;
    } & Record<string, unknown>)[];
    id: number;
    name?: string;
    type: 'qemu' | 'lxc' | 'unknown';
  } & Record<string, unknown>)[];
} & Record<string, unknown>;

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
  max_relocate?: string;
  max_restart?: string;
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
  max_relocate?: string;
  max_restart?: string;
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

/** POST /cluster/ha/rules — `data` payload after client unwrap. */
export type ClusterHaRulesPostReturn = null;

/** GET /cluster/ha/rules/{rule} — `data` payload after client unwrap. */
export type ClusterHaRulesRuleGetReturn = {
  rule: string;
  type: 'node-affinity' | 'resource-affinity';
} & Record<string, unknown>;

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

/** GET /cluster/ceph — `data` payload after client unwrap. */
export type ClusterCephGetReturn = readonly Record<string, unknown>[];

/** GET /cluster/ceph/metadata — form/query parameters (path segments omitted). */
export type ClusterCephMetadataGetParams = { scope?: 'all' | 'versions' };
/** GET /cluster/ceph/metadata — `data` payload after client unwrap. */
export type ClusterCephMetadataGetReturn = {
  mds: unknown;
  mgr: unknown;
  mon: unknown;
  node: unknown;
  osd: readonly ({
    back_addr: string;
    ceph_release: string;
    ceph_version: string;
    ceph_version_short: string;
    device_ids?: string;
    device_paths?: string;
    devices?: string;
    front_addr: string;
    hostname: string;
    id: number;
    mem_swap_kb: number;
    mem_total_kb: number;
    osd_data: string;
    osd_objectstore: string;
  } & Record<string, unknown>)[];
} & Record<string, unknown>;

/** GET /cluster/ceph/status — `data` payload after client unwrap. */
export type ClusterCephStatusGetReturn = unknown;

/** POST /cluster/ceph/restart-bulk — form/query parameters (path segments omitted). */
export type ClusterCephRestartBulkPostParams = {
  'dry-run'?: '0' | '1';
  force?: '0' | '1';
  'only-outdated'?: '0' | '1';
  'service-type': 'mon' | 'mgr' | 'mds' | 'osd';
  timeout?: string;
};
/** POST /cluster/ceph/restart-bulk — `data` payload after client unwrap. */
export type ClusterCephRestartBulkPostReturn = string;

/** GET /cluster/ceph/flags — `data` payload after client unwrap. */
export type ClusterCephFlagsGetReturn = readonly ({
  description: string;
  name:
    | 'nobackfill'
    | 'nodeep-scrub'
    | 'nodown'
    | 'noin'
    | 'noout'
    | 'norebalance'
    | 'norecover'
    | 'noscrub'
    | 'notieragent'
    | 'noup'
    | 'pause';
  value: boolean | 0 | 1;
} & Record<string, unknown>)[];

/** PUT /cluster/ceph/flags — form/query parameters (path segments omitted). */
export type ClusterCephFlagsPutParams = {
  nobackfill?: '0' | '1';
  'nodeep-scrub'?: '0' | '1';
  nodown?: '0' | '1';
  noin?: '0' | '1';
  noout?: '0' | '1';
  norebalance?: '0' | '1';
  norecover?: '0' | '1';
  noscrub?: '0' | '1';
  notieragent?: '0' | '1';
  noup?: '0' | '1';
  pause?: '0' | '1';
};
/** PUT /cluster/ceph/flags — `data` payload after client unwrap. */
export type ClusterCephFlagsPutReturn = string;

/** GET /cluster/ceph/flags/{flag} — `data` payload after client unwrap. */
export type ClusterCephFlagsFlagGetReturn = boolean | 0 | 1;

/** PUT /cluster/ceph/flags/{flag} — form/query parameters (path segments omitted). */
export type ClusterCephFlagsFlagPutParams = { value: '0' | '1' };
/** PUT /cluster/ceph/flags/{flag} — `data` payload after client unwrap. */
export type ClusterCephFlagsFlagPutReturn = null;

/** GET /cluster/sdn — `data` payload after client unwrap. */
export type ClusterSdnGetReturn = readonly ({ id: string } & Record<string, unknown>)[];

/** PUT /cluster/sdn — form/query parameters (path segments omitted). */
export type ClusterSdnPutParams = { 'lock-token'?: string; 'release-lock'?: '0' | '1' };
/** PUT /cluster/sdn — `data` payload after client unwrap. */
export type ClusterSdnPutReturn = string;

/** GET /cluster/sdn/vnets — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/vnets — `data` payload after client unwrap. */
export type ClusterSdnVnetsGetReturn = readonly ({
  alias?: string;
  digest?: string;
  'isolate-ports'?: boolean | 0 | 1;
  pending?: {
    alias?: string;
    'isolate-ports'?: boolean | 0 | 1;
    tag?: number;
    vlanaware?: boolean | 0 | 1;
    zone?: string;
  } & Record<string, unknown>;
  state?: 'new' | 'changed' | 'deleted';
  tag?: number;
  type: 'vnet';
  vlanaware?: boolean | 0 | 1;
  vnet: string;
  zone?: string;
} & Record<string, unknown>)[];

/** POST /cluster/sdn/vnets — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsPostParams = {
  alias?: string;
  'isolate-ports'?: '0' | '1';
  'lock-token'?: string;
  tag?: string;
  type?: 'vnet';
  vlanaware?: '0' | '1';
  vnet: string;
  zone: string;
};
/** POST /cluster/sdn/vnets — `data` payload after client unwrap. */
export type ClusterSdnVnetsPostReturn = null;

/** GET /cluster/sdn/vnets/{vnet} — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/vnets/{vnet} — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetGetReturn = {
  alias?: string;
  digest?: string;
  'isolate-ports'?: boolean | 0 | 1;
  pending?: {
    alias?: string;
    'isolate-ports'?: boolean | 0 | 1;
    tag?: number;
    vlanaware?: boolean | 0 | 1;
    zone?: string;
  } & Record<string, unknown>;
  state?: 'new' | 'changed' | 'deleted';
  tag?: number;
  type: 'vnet';
  vlanaware?: boolean | 0 | 1;
  vnet: string;
  zone?: string;
} & Record<string, unknown>;

/** PUT /cluster/sdn/vnets/{vnet} — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetPutParams = {
  alias?: string;
  delete?: string;
  digest?: string;
  'isolate-ports'?: '0' | '1';
  'lock-token'?: string;
  tag?: string;
  vlanaware?: '0' | '1';
  zone?: string;
};
/** PUT /cluster/sdn/vnets/{vnet} — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetPutReturn = null;

/** DELETE /cluster/sdn/vnets/{vnet} — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetDeleteParams = { 'lock-token'?: string };
/** DELETE /cluster/sdn/vnets/{vnet} — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetDeleteReturn = null;

/** GET /cluster/sdn/vnets/{vnet}/firewall — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetFirewallGetReturn = readonly Record<string, unknown>[];

/** GET /cluster/sdn/vnets/{vnet}/firewall/rules — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetFirewallRulesGetReturn = readonly ({
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

/** POST /cluster/sdn/vnets/{vnet}/firewall/rules — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetFirewallRulesPostParams = {
  action: string;
  comment?: string;
  dest?: string;
  digest?: string;
  dport?: string;
  enable?: string;
  'icmp-type'?: string;
  iface?: string;
  log?: 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug' | 'nolog';
  macro?: string;
  pos?: string;
  proto?: string;
  source?: string;
  sport?: string;
  type: 'in' | 'out' | 'forward' | 'group';
};
/** POST /cluster/sdn/vnets/{vnet}/firewall/rules — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetFirewallRulesPostReturn = null;

/** GET /cluster/sdn/vnets/{vnet}/firewall/rules/{pos} — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetFirewallRulesPosGetReturn = {
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

/** PUT /cluster/sdn/vnets/{vnet}/firewall/rules/{pos} — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetFirewallRulesPosPutParams = {
  action?: string;
  comment?: string;
  delete?: string;
  dest?: string;
  digest?: string;
  dport?: string;
  enable?: string;
  'icmp-type'?: string;
  iface?: string;
  log?: 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug' | 'nolog';
  macro?: string;
  moveto?: string;
  proto?: string;
  source?: string;
  sport?: string;
  type?: 'in' | 'out' | 'forward' | 'group';
};
/** PUT /cluster/sdn/vnets/{vnet}/firewall/rules/{pos} — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetFirewallRulesPosPutReturn = null;

/** DELETE /cluster/sdn/vnets/{vnet}/firewall/rules/{pos} — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetFirewallRulesPosDeleteParams = { digest?: string };
/** DELETE /cluster/sdn/vnets/{vnet}/firewall/rules/{pos} — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetFirewallRulesPosDeleteReturn = null;

/** GET /cluster/sdn/vnets/{vnet}/firewall/options — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetFirewallOptionsGetReturn = {
  enable?: boolean | 0 | 1;
  log_level_forward?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  policy_forward?: 'ACCEPT' | 'DROP';
} & Record<string, unknown>;

/** PUT /cluster/sdn/vnets/{vnet}/firewall/options — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetFirewallOptionsPutParams = {
  delete?: string;
  digest?: string;
  enable?: '0' | '1';
  log_level_forward?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  policy_forward?: 'ACCEPT' | 'DROP';
};
/** PUT /cluster/sdn/vnets/{vnet}/firewall/options — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetFirewallOptionsPutReturn = null;

/** GET /cluster/sdn/vnets/{vnet}/subnets — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetSubnetsGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/vnets/{vnet}/subnets — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetSubnetsGetReturn = readonly Record<string, unknown>[];

/** POST /cluster/sdn/vnets/{vnet}/subnets — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetSubnetsPostParams = {
  'dhcp-dns-server'?: string;
  'dhcp-range'?: readonly string[];
  dnszoneprefix?: string;
  gateway?: string;
  'lock-token'?: string;
  snat?: '0' | '1';
  subnet: string;
  type: 'subnet';
};
/** POST /cluster/sdn/vnets/{vnet}/subnets — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetSubnetsPostReturn = null;

/** GET /cluster/sdn/vnets/{vnet}/subnets/{subnet} — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetSubnetsSubnetGetParams = {
  pending?: '0' | '1';
  running?: '0' | '1';
};
/** GET /cluster/sdn/vnets/{vnet}/subnets/{subnet} — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetSubnetsSubnetGetReturn = unknown;

/** PUT /cluster/sdn/vnets/{vnet}/subnets/{subnet} — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetSubnetsSubnetPutParams = {
  delete?: string;
  'dhcp-dns-server'?: string;
  'dhcp-range'?: readonly string[];
  digest?: string;
  dnszoneprefix?: string;
  gateway?: string;
  'lock-token'?: string;
  snat?: '0' | '1';
};
/** PUT /cluster/sdn/vnets/{vnet}/subnets/{subnet} — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetSubnetsSubnetPutReturn = null;

/** DELETE /cluster/sdn/vnets/{vnet}/subnets/{subnet} — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetSubnetsSubnetDeleteParams = { 'lock-token'?: string };
/** DELETE /cluster/sdn/vnets/{vnet}/subnets/{subnet} — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetSubnetsSubnetDeleteReturn = null;

/** POST /cluster/sdn/vnets/{vnet}/ips — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetIpsPostParams = { ip: string; mac?: string; zone: string };
/** POST /cluster/sdn/vnets/{vnet}/ips — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetIpsPostReturn = null;

/** PUT /cluster/sdn/vnets/{vnet}/ips — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetIpsPutParams = {
  ip: string;
  mac?: string;
  vmid?: string;
  zone: string;
};
/** PUT /cluster/sdn/vnets/{vnet}/ips — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetIpsPutReturn = null;

/** DELETE /cluster/sdn/vnets/{vnet}/ips — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetIpsDeleteParams = { ip: string; mac?: string; zone: string };
/** DELETE /cluster/sdn/vnets/{vnet}/ips — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetIpsDeleteReturn = null;

/** GET /cluster/sdn/zones — form/query parameters (path segments omitted). */
export type ClusterSdnZonesGetParams = {
  pending?: '0' | '1';
  running?: '0' | '1';
  type?: 'evpn' | 'faucet' | 'qinq' | 'simple' | 'vlan' | 'vxlan';
};
/** GET /cluster/sdn/zones — `data` payload after client unwrap. */
export type ClusterSdnZonesGetReturn = readonly ({
  'advertise-subnets'?: boolean | 0 | 1;
  bridge?: string;
  'bridge-disable-mac-learning'?: boolean | 0 | 1;
  controller?: string;
  dhcp?: 'dnsmasq';
  digest?: string;
  'disable-arp-nd-suppression'?: boolean | 0 | 1;
  dns?: string;
  dnszone?: string;
  exitnodes?: string;
  'exitnodes-local-routing'?: boolean | 0 | 1;
  'exitnodes-primary'?: string;
  ipam?: string;
  mac?: string;
  mtu?: number;
  nodes?: string;
  peers?: string;
  pending?: {
    'advertise-subnets'?: boolean | 0 | 1;
    bridge?: string;
    'bridge-disable-mac-learning'?: boolean | 0 | 1;
    controller?: string;
    dhcp?: 'dnsmasq';
    'disable-arp-nd-suppression'?: boolean | 0 | 1;
    dns?: string;
    dnszone?: string;
    exitnodes?: string;
    'exitnodes-local-routing'?: boolean | 0 | 1;
    'exitnodes-primary'?: string;
    ipam?: string;
    mac?: string;
    mtu?: number;
    nodes?: string;
    peers?: string;
    reversedns?: string;
    'rt-import'?: string;
    'secondary-controllers'?: readonly string[];
    tag?: number;
    'vlan-protocol'?: '802.1q' | '802.1ad';
    'vrf-vxlan'?: number;
    'vxlan-port'?: number;
  } & Record<string, unknown>;
  reversedns?: string;
  'rt-import'?: string;
  'secondary-controllers'?: readonly string[];
  state?: 'new' | 'changed' | 'deleted';
  tag?: number;
  type: 'evpn' | 'faucet' | 'qinq' | 'simple' | 'vlan' | 'vxlan';
  'vlan-protocol'?: '802.1q' | '802.1ad';
  'vrf-vxlan'?: number;
  'vxlan-port'?: number;
  zone: string;
} & Record<string, unknown>)[];

/** POST /cluster/sdn/zones — form/query parameters (path segments omitted). */
export type ClusterSdnZonesPostParams = {
  'advertise-subnets'?: '0' | '1';
  bridge?: string;
  'bridge-disable-mac-learning'?: '0' | '1';
  controller?: string;
  dhcp?: 'dnsmasq';
  'disable-arp-nd-suppression'?: '0' | '1';
  dns?: string;
  dnszone?: string;
  'dp-id'?: string;
  exitnodes?: string;
  'exitnodes-local-routing'?: '0' | '1';
  'exitnodes-primary'?: string;
  fabric?: string;
  ipam?: string;
  'lock-token'?: string;
  mac?: string;
  mtu?: string;
  nodes?: string;
  peers?: string;
  reversedns?: string;
  'rt-import'?: string;
  'secondary-controllers'?: readonly string[];
  tag?: string;
  type: 'evpn' | 'faucet' | 'qinq' | 'simple' | 'vlan' | 'vxlan';
  'vlan-protocol'?: '802.1q' | '802.1ad';
  'vrf-vxlan'?: string;
  'vxlan-port'?: string;
  zone: string;
};
/** POST /cluster/sdn/zones — `data` payload after client unwrap. */
export type ClusterSdnZonesPostReturn = null;

/** GET /cluster/sdn/zones/{zone} — form/query parameters (path segments omitted). */
export type ClusterSdnZonesZoneGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/zones/{zone} — `data` payload after client unwrap. */
export type ClusterSdnZonesZoneGetReturn = {
  'advertise-subnets'?: boolean | 0 | 1;
  bridge?: string;
  'bridge-disable-mac-learning'?: boolean | 0 | 1;
  controller?: string;
  dhcp?: 'dnsmasq';
  digest?: string;
  'disable-arp-nd-suppression'?: boolean | 0 | 1;
  dns?: string;
  dnszone?: string;
  exitnodes?: string;
  'exitnodes-local-routing'?: boolean | 0 | 1;
  'exitnodes-primary'?: string;
  ipam?: string;
  mac?: string;
  mtu?: number;
  nodes?: string;
  peers?: string;
  pending?: {
    'advertise-subnets'?: boolean | 0 | 1;
    bridge?: string;
    'bridge-disable-mac-learning'?: boolean | 0 | 1;
    controller?: string;
    dhcp?: 'dnsmasq';
    'disable-arp-nd-suppression'?: boolean | 0 | 1;
    dns?: string;
    dnszone?: string;
    exitnodes?: string;
    'exitnodes-local-routing'?: boolean | 0 | 1;
    'exitnodes-primary'?: string;
    ipam?: string;
    mac?: string;
    mtu?: number;
    nodes?: string;
    peers?: string;
    reversedns?: string;
    'rt-import'?: string;
    'secondary-controllers'?: readonly string[];
    tag?: number;
    'vlan-protocol'?: '802.1q' | '802.1ad';
    'vrf-vxlan'?: number;
    'vxlan-port'?: number;
  } & Record<string, unknown>;
  reversedns?: string;
  'rt-import'?: string;
  'secondary-controllers'?: readonly string[];
  state?: 'new' | 'changed' | 'deleted';
  tag?: number;
  type: 'evpn' | 'faucet' | 'qinq' | 'simple' | 'vlan' | 'vxlan';
  'vlan-protocol'?: '802.1q' | '802.1ad';
  'vrf-vxlan'?: number;
  'vxlan-port'?: number;
  zone: string;
} & Record<string, unknown>;

/** PUT /cluster/sdn/zones/{zone} — form/query parameters (path segments omitted). */
export type ClusterSdnZonesZonePutParams = {
  'advertise-subnets'?: '0' | '1';
  bridge?: string;
  'bridge-disable-mac-learning'?: '0' | '1';
  controller?: string;
  delete?: string;
  dhcp?: 'dnsmasq';
  digest?: string;
  'disable-arp-nd-suppression'?: '0' | '1';
  dns?: string;
  dnszone?: string;
  'dp-id'?: string;
  exitnodes?: string;
  'exitnodes-local-routing'?: '0' | '1';
  'exitnodes-primary'?: string;
  fabric?: string;
  ipam?: string;
  'lock-token'?: string;
  mac?: string;
  mtu?: string;
  nodes?: string;
  peers?: string;
  reversedns?: string;
  'rt-import'?: string;
  'secondary-controllers'?: readonly string[];
  tag?: string;
  'vlan-protocol'?: '802.1q' | '802.1ad';
  'vrf-vxlan'?: string;
  'vxlan-port'?: string;
};
/** PUT /cluster/sdn/zones/{zone} — `data` payload after client unwrap. */
export type ClusterSdnZonesZonePutReturn = null;

/** DELETE /cluster/sdn/zones/{zone} — form/query parameters (path segments omitted). */
export type ClusterSdnZonesZoneDeleteParams = { 'lock-token'?: string };
/** DELETE /cluster/sdn/zones/{zone} — `data` payload after client unwrap. */
export type ClusterSdnZonesZoneDeleteReturn = null;

/** GET /cluster/sdn/controllers — form/query parameters (path segments omitted). */
export type ClusterSdnControllersGetParams = {
  pending?: '0' | '1';
  running?: '0' | '1';
  type?: 'bgp' | 'evpn' | 'faucet' | 'isis';
};
/** GET /cluster/sdn/controllers — `data` payload after client unwrap. */
export type ClusterSdnControllersGetReturn = readonly ({
  asn?: number;
  'bgp-mode'?: 'auto' | 'external' | 'internal';
  'bgp-multipath-as-relax'?: boolean | 0 | 1;
  controller: string;
  digest?: string;
  ebgp?: boolean | 0 | 1;
  'ebgp-multihop'?: number;
  'isis-domain'?: string;
  'isis-ifaces'?: string;
  'isis-net'?: string;
  loopback?: string;
  node?: string;
  nodes?: string;
  'peer-group-name'?: string;
  peers?: string;
  pending?: {
    asn?: number;
    'bgp-mode'?: 'auto' | 'external' | 'internal';
    'bgp-multipath-as-relax'?: boolean | 0 | 1;
    ebgp?: boolean | 0 | 1;
    'ebgp-multihop'?: number;
    'isis-domain'?: string;
    'isis-ifaces'?: string;
    'isis-net'?: string;
    loopback?: string;
    node?: string;
    nodes?: string;
    'peer-group-name'?: string;
    peers?: string;
  } & Record<string, unknown>;
  state?: 'new' | 'changed' | 'deleted';
  type: 'bgp' | 'evpn' | 'faucet' | 'isis';
} & Record<string, unknown>)[];

/** POST /cluster/sdn/controllers — form/query parameters (path segments omitted). */
export type ClusterSdnControllersPostParams = {
  asn?: string;
  'bgp-mode'?: 'auto' | 'external' | 'internal';
  'bgp-multipath-as-path-relax'?: '0' | '1';
  controller: string;
  ebgp?: '0' | '1';
  'ebgp-multihop'?: string;
  fabric?: string;
  'isis-domain'?: string;
  'isis-ifaces'?: string;
  'isis-net'?: string;
  'lock-token'?: string;
  loopback?: string;
  node?: string;
  nodes?: string;
  'peer-group-name'?: string;
  peers?: string;
  'route-map-in'?: string;
  'route-map-out'?: string;
  type: 'bgp' | 'evpn' | 'faucet' | 'isis';
};
/** POST /cluster/sdn/controllers — `data` payload after client unwrap. */
export type ClusterSdnControllersPostReturn = null;

/** GET /cluster/sdn/controllers/{controller} — form/query parameters (path segments omitted). */
export type ClusterSdnControllersControllerGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/controllers/{controller} — `data` payload after client unwrap. */
export type ClusterSdnControllersControllerGetReturn = {
  asn?: number;
  'bgp-mode'?: 'auto' | 'external' | 'internal';
  'bgp-multipath-as-relax'?: boolean | 0 | 1;
  controller: string;
  digest?: string;
  ebgp?: boolean | 0 | 1;
  'ebgp-multihop'?: number;
  'isis-domain'?: string;
  'isis-ifaces'?: string;
  'isis-net'?: string;
  loopback?: string;
  node?: string;
  nodes?: string;
  'peer-group-name'?: string;
  peers?: string;
  pending?: {
    asn?: number;
    'bgp-mode'?: 'auto' | 'external' | 'internal';
    'bgp-multipath-as-relax'?: boolean | 0 | 1;
    ebgp?: boolean | 0 | 1;
    'ebgp-multihop'?: number;
    'isis-domain'?: string;
    'isis-ifaces'?: string;
    'isis-net'?: string;
    loopback?: string;
    node?: string;
    nodes?: string;
    'peer-group-name'?: string;
    peers?: string;
  } & Record<string, unknown>;
  state?: 'new' | 'changed' | 'deleted';
  type: 'bgp' | 'evpn' | 'faucet' | 'isis';
} & Record<string, unknown>;

/** PUT /cluster/sdn/controllers/{controller} — form/query parameters (path segments omitted). */
export type ClusterSdnControllersControllerPutParams = {
  asn?: string;
  'bgp-mode'?: 'auto' | 'external' | 'internal';
  'bgp-multipath-as-path-relax'?: '0' | '1';
  delete?: string;
  digest?: string;
  ebgp?: '0' | '1';
  'ebgp-multihop'?: string;
  fabric?: string;
  'isis-domain'?: string;
  'isis-ifaces'?: string;
  'isis-net'?: string;
  'lock-token'?: string;
  loopback?: string;
  node?: string;
  nodes?: string;
  'peer-group-name'?: string;
  peers?: string;
  'route-map-in'?: string;
  'route-map-out'?: string;
};
/** PUT /cluster/sdn/controllers/{controller} — `data` payload after client unwrap. */
export type ClusterSdnControllersControllerPutReturn = null;

/** DELETE /cluster/sdn/controllers/{controller} — form/query parameters (path segments omitted). */
export type ClusterSdnControllersControllerDeleteParams = { 'lock-token'?: string };
/** DELETE /cluster/sdn/controllers/{controller} — `data` payload after client unwrap. */
export type ClusterSdnControllersControllerDeleteReturn = null;

/** GET /cluster/sdn/ipams — form/query parameters (path segments omitted). */
export type ClusterSdnIpamsGetParams = { type?: 'netbox' | 'phpipam' | 'pve' };
/** GET /cluster/sdn/ipams — `data` payload after client unwrap. */
export type ClusterSdnIpamsGetReturn = readonly ({ ipam: string; type: string } & Record<
  string,
  unknown
>)[];

/** POST /cluster/sdn/ipams — form/query parameters (path segments omitted). */
export type ClusterSdnIpamsPostParams = {
  fingerprint?: string;
  ipam: string;
  'lock-token'?: string;
  section?: string;
  token?: string;
  type: 'netbox' | 'phpipam' | 'pve';
  url?: string;
};
/** POST /cluster/sdn/ipams — `data` payload after client unwrap. */
export type ClusterSdnIpamsPostReturn = null;

/** GET /cluster/sdn/ipams/{ipam} — `data` payload after client unwrap. */
export type ClusterSdnIpamsIpamGetReturn = unknown;

/** PUT /cluster/sdn/ipams/{ipam} — form/query parameters (path segments omitted). */
export type ClusterSdnIpamsIpamPutParams = {
  delete?: string;
  digest?: string;
  fingerprint?: string;
  'lock-token'?: string;
  section?: string;
  token?: string;
  url?: string;
};
/** PUT /cluster/sdn/ipams/{ipam} — `data` payload after client unwrap. */
export type ClusterSdnIpamsIpamPutReturn = null;

/** DELETE /cluster/sdn/ipams/{ipam} — form/query parameters (path segments omitted). */
export type ClusterSdnIpamsIpamDeleteParams = { 'lock-token'?: string };
/** DELETE /cluster/sdn/ipams/{ipam} — `data` payload after client unwrap. */
export type ClusterSdnIpamsIpamDeleteReturn = null;

/** GET /cluster/sdn/ipams/{ipam}/status — `data` payload after client unwrap. */
export type ClusterSdnIpamsIpamStatusGetReturn = readonly unknown[];

/** GET /cluster/sdn/dns — form/query parameters (path segments omitted). */
export type ClusterSdnDnsGetParams = { type?: 'powerdns' };
/** GET /cluster/sdn/dns — `data` payload after client unwrap. */
export type ClusterSdnDnsGetReturn = readonly ({ dns: string; type: string } & Record<
  string,
  unknown
>)[];

/** POST /cluster/sdn/dns — form/query parameters (path segments omitted). */
export type ClusterSdnDnsPostParams = {
  dns: string;
  fingerprint?: string;
  key: string;
  'lock-token'?: string;
  reversemaskv6?: string;
  reversev6mask?: string;
  ttl?: string;
  type: 'powerdns';
  url: string;
};
/** POST /cluster/sdn/dns — `data` payload after client unwrap. */
export type ClusterSdnDnsPostReturn = null;

/** GET /cluster/sdn/dns/{dns} — `data` payload after client unwrap. */
export type ClusterSdnDnsDnsGetReturn = unknown;

/** PUT /cluster/sdn/dns/{dns} — form/query parameters (path segments omitted). */
export type ClusterSdnDnsDnsPutParams = {
  delete?: string;
  digest?: string;
  fingerprint?: string;
  key?: string;
  'lock-token'?: string;
  reversemaskv6?: string;
  ttl?: string;
  url?: string;
};
/** PUT /cluster/sdn/dns/{dns} — `data` payload after client unwrap. */
export type ClusterSdnDnsDnsPutReturn = null;

/** DELETE /cluster/sdn/dns/{dns} — form/query parameters (path segments omitted). */
export type ClusterSdnDnsDnsDeleteParams = { 'lock-token'?: string };
/** DELETE /cluster/sdn/dns/{dns} — `data` payload after client unwrap. */
export type ClusterSdnDnsDnsDeleteReturn = null;

/** GET /cluster/sdn/fabrics — `data` payload after client unwrap. */
export type ClusterSdnFabricsGetReturn = readonly ({ subdir: string } & Record<string, unknown>)[];

/** GET /cluster/sdn/fabrics/fabric — form/query parameters (path segments omitted). */
export type ClusterSdnFabricsFabricGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/fabrics/fabric — `data` payload after client unwrap. */
export type ClusterSdnFabricsFabricGetReturn = readonly ({
  area?: string;
  csnp_interval?: number;
  digest?: string;
  hello_interval?: number;
  id: string;
  ip6_prefix?: string;
  ip_prefix?: string;
  'lock-token'?: string;
  persistent_keepalive?: number;
  protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
  redistribute: readonly unknown[];
  route_filter?: string;
} & Record<string, unknown>)[];

/** POST /cluster/sdn/fabrics/fabric — form/query parameters (path segments omitted). */
export type ClusterSdnFabricsFabricPostParams = {
  area?: string;
  csnp_interval?: string;
  digest?: string;
  hello_interval?: string;
  id: string;
  ip6_prefix?: string;
  ip_prefix?: string;
  'lock-token'?: string;
  persistent_keepalive?: string;
  protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
  redistribute: readonly string[];
  route_filter?: string;
};
/** POST /cluster/sdn/fabrics/fabric — `data` payload after client unwrap. */
export type ClusterSdnFabricsFabricPostReturn = null;

/** GET /cluster/sdn/fabrics/fabric/{id} — `data` payload after client unwrap. */
export type ClusterSdnFabricsFabricIdGetReturn = {
  area?: string;
  csnp_interval?: number;
  digest?: string;
  hello_interval?: number;
  id: string;
  ip6_prefix?: string;
  ip_prefix?: string;
  'lock-token'?: string;
  persistent_keepalive?: number;
  protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
  redistribute: readonly unknown[];
  route_filter?: string;
} & Record<string, unknown>;

/** PUT /cluster/sdn/fabrics/fabric/{id} — form/query parameters (path segments omitted). */
export type ClusterSdnFabricsFabricIdPutParams = {
  area?: string;
  csnp_interval?: string;
  delete: readonly string[];
  digest?: string;
  hello_interval?: string;
  ip6_prefix?: string;
  ip_prefix?: string;
  'lock-token'?: string;
  persistent_keepalive?: string;
  protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
  redistribute: readonly string[];
  route_filter?: string;
};
/** PUT /cluster/sdn/fabrics/fabric/{id} — `data` payload after client unwrap. */
export type ClusterSdnFabricsFabricIdPutReturn = null;

/** DELETE /cluster/sdn/fabrics/fabric/{id} — `data` payload after client unwrap. */
export type ClusterSdnFabricsFabricIdDeleteReturn = null;

/** GET /cluster/sdn/fabrics/node — form/query parameters (path segments omitted). */
export type ClusterSdnFabricsNodeGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/fabrics/node — `data` payload after client unwrap. */
export type ClusterSdnFabricsNodeGetReturn = readonly ({
  allowed_ips?: readonly string[];
  digest?: string;
  endpoint?: string;
  fabric_id: string;
  interfaces: readonly unknown[];
  ip?: string;
  ip6?: string;
  'lock-token'?: string;
  node_id: string;
  peers?: readonly string[];
  protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
  public_key?: string;
  role?: 'internal' | 'external';
} & Record<string, unknown>)[];

/** GET /cluster/sdn/fabrics/node/{fabric_id} — form/query parameters (path segments omitted). */
export type ClusterSdnFabricsNodeFabric_idGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/fabrics/node/{fabric_id} — `data` payload after client unwrap. */
export type ClusterSdnFabricsNodeFabric_idGetReturn = readonly ({
  allowed_ips?: readonly string[];
  digest?: string;
  endpoint?: string;
  fabric_id: string;
  interfaces: readonly unknown[];
  ip?: string;
  ip6?: string;
  'lock-token'?: string;
  node_id: string;
  peers?: readonly string[];
  protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
  public_key?: string;
  role?: 'internal' | 'external';
} & Record<string, unknown>)[];

/** POST /cluster/sdn/fabrics/node/{fabric_id} — form/query parameters (path segments omitted). */
export type ClusterSdnFabricsNodeFabric_idPostParams = {
  allowed_ips?: readonly string[];
  digest?: string;
  endpoint?: string;
  interfaces: readonly string[];
  ip?: string;
  ip6?: string;
  'lock-token'?: string;
  node_id: string;
  peers?: readonly string[];
  protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
  public_key?: string;
  role?: 'internal' | 'external';
};
/** POST /cluster/sdn/fabrics/node/{fabric_id} — `data` payload after client unwrap. */
export type ClusterSdnFabricsNodeFabric_idPostReturn = null;

/** GET /cluster/sdn/fabrics/node/{fabric_id}/{node_id} — `data` payload after client unwrap. */
export type ClusterSdnFabricsNodeFabric_idNode_idGetReturn = {
  allowed_ips?: readonly string[];
  digest?: string;
  endpoint?: string;
  fabric_id: string;
  interfaces: readonly unknown[];
  ip?: string;
  ip6?: string;
  'lock-token'?: string;
  node_id: string;
  peers?: readonly string[];
  protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
  public_key?: string;
  role?: 'internal' | 'external';
} & Record<string, unknown>;

/** PUT /cluster/sdn/fabrics/node/{fabric_id}/{node_id} — form/query parameters (path segments omitted). */
export type ClusterSdnFabricsNodeFabric_idNode_idPutParams = {
  allowed_ips?: readonly string[];
  delete: readonly string[];
  digest?: string;
  endpoint?: string;
  interfaces: readonly string[];
  ip?: string;
  ip6?: string;
  'lock-token'?: string;
  peers?: readonly string[];
  protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
  public_key?: string;
  role?: 'internal' | 'external';
};
/** PUT /cluster/sdn/fabrics/node/{fabric_id}/{node_id} — `data` payload after client unwrap. */
export type ClusterSdnFabricsNodeFabric_idNode_idPutReturn = null;

/** DELETE /cluster/sdn/fabrics/node/{fabric_id}/{node_id} — `data` payload after client unwrap. */
export type ClusterSdnFabricsNodeFabric_idNode_idDeleteReturn = null;

/** GET /cluster/sdn/fabrics/all — form/query parameters (path segments omitted). */
export type ClusterSdnFabricsAllGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/fabrics/all — `data` payload after client unwrap. */
export type ClusterSdnFabricsAllGetReturn = {
  fabrics: readonly ({
    area?: string;
    csnp_interval?: number;
    digest?: string;
    hello_interval?: number;
    id: string;
    ip6_prefix?: string;
    ip_prefix?: string;
    'lock-token'?: string;
    persistent_keepalive?: number;
    protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
    redistribute: readonly unknown[];
    route_filter?: string;
  } & Record<string, unknown>)[];
  nodes: readonly ({
    allowed_ips?: readonly string[];
    digest?: string;
    endpoint?: string;
    fabric_id: string;
    interfaces: readonly unknown[];
    ip?: string;
    ip6?: string;
    'lock-token'?: string;
    node_id: string;
    peers?: readonly string[];
    protocol: 'openfabric' | 'ospf' | 'wireguard' | 'bgp';
    public_key?: string;
    role?: 'internal' | 'external';
  } & Record<string, unknown>)[];
} & Record<string, unknown>;

/** GET /cluster/sdn/prefix-lists — form/query parameters (path segments omitted). */
export type ClusterSdnPrefixListsGetParams = {
  pending?: '0' | '1';
  running?: '0' | '1';
  verbose?: '0' | '1';
};
/** GET /cluster/sdn/prefix-lists — `data` payload after client unwrap. */
export type ClusterSdnPrefixListsGetReturn = readonly Record<string, unknown>[];

/** POST /cluster/sdn/prefix-lists — form/query parameters (path segments omitted). */
export type ClusterSdnPrefixListsPostParams = {
  digest?: string;
  entries?: readonly string[];
  id: string;
  'lock-token'?: string;
};
/** POST /cluster/sdn/prefix-lists — `data` payload after client unwrap. */
export type ClusterSdnPrefixListsPostReturn = null;

/** GET /cluster/sdn/prefix-lists/{id} — `data` payload after client unwrap. */
export type ClusterSdnPrefixListsIdGetReturn = unknown;

/** PUT /cluster/sdn/prefix-lists/{id} — form/query parameters (path segments omitted). */
export type ClusterSdnPrefixListsIdPutParams = {
  delete?: readonly 'entries'[];
  digest?: string;
  entries?: readonly string[];
  'lock-token'?: string;
};
/** PUT /cluster/sdn/prefix-lists/{id} — `data` payload after client unwrap. */
export type ClusterSdnPrefixListsIdPutReturn = null;

/** DELETE /cluster/sdn/prefix-lists/{id} — form/query parameters (path segments omitted). */
export type ClusterSdnPrefixListsIdDeleteParams = { 'lock-token'?: string };
/** DELETE /cluster/sdn/prefix-lists/{id} — `data` payload after client unwrap. */
export type ClusterSdnPrefixListsIdDeleteReturn = null;

/** GET /cluster/sdn/prefix-lists/{id}/entries — `data` payload after client unwrap. */
export type ClusterSdnPrefixListsIdEntriesGetReturn = readonly Record<string, unknown>[];

/** POST /cluster/sdn/prefix-lists/{id}/entries — form/query parameters (path segments omitted). */
export type ClusterSdnPrefixListsIdEntriesPostParams = {
  action: 'permit' | 'deny';
  ge?: string;
  le?: string;
  'lock-token'?: string;
  prefix: string;
  seq?: string;
};
/** POST /cluster/sdn/prefix-lists/{id}/entries — `data` payload after client unwrap. */
export type ClusterSdnPrefixListsIdEntriesPostReturn = null;

/** GET /cluster/sdn/prefix-lists/{id}/entries/{url_seq} — `data` payload after client unwrap. */
export type ClusterSdnPrefixListsIdEntriesUrl_seqGetReturn = unknown;

/** PUT /cluster/sdn/prefix-lists/{id}/entries/{url_seq} — form/query parameters (path segments omitted). */
export type ClusterSdnPrefixListsIdEntriesUrl_seqPutParams = {
  action?: 'permit' | 'deny';
  delete?: readonly ('le' | 'ge' | 'seq')[];
  digest?: string;
  ge?: string;
  le?: string;
  'lock-token'?: string;
  prefix?: string;
  seq?: string;
};
/** PUT /cluster/sdn/prefix-lists/{id}/entries/{url_seq} — `data` payload after client unwrap. */
export type ClusterSdnPrefixListsIdEntriesUrl_seqPutReturn = null;

/** DELETE /cluster/sdn/prefix-lists/{id}/entries/{url_seq} — form/query parameters (path segments omitted). */
export type ClusterSdnPrefixListsIdEntriesUrl_seqDeleteParams = { 'lock-token'?: string };
/** DELETE /cluster/sdn/prefix-lists/{id}/entries/{url_seq} — `data` payload after client unwrap. */
export type ClusterSdnPrefixListsIdEntriesUrl_seqDeleteReturn = null;

/** GET /cluster/sdn/route-maps — form/query parameters (path segments omitted). */
export type ClusterSdnRouteMapsGetParams = { running?: '0' | '1' };
/** GET /cluster/sdn/route-maps — `data` payload after client unwrap. */
export type ClusterSdnRouteMapsGetReturn = readonly ({ id: string } & Record<string, unknown>)[];

/** GET /cluster/sdn/route-maps/entries — form/query parameters (path segments omitted). */
export type ClusterSdnRouteMapsEntriesGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/route-maps/entries — `data` payload after client unwrap. */
export type ClusterSdnRouteMapsEntriesGetReturn = readonly ({
  action: 'permit' | 'deny';
  call?: string;
  digest?: string;
  'exit-action'?: string;
  match?: readonly string[];
  order: number;
  'route-map-id': string;
  set?: readonly string[];
} & Record<string, unknown>)[];

/** POST /cluster/sdn/route-maps/entries — form/query parameters (path segments omitted). */
export type ClusterSdnRouteMapsEntriesPostParams = {
  action: 'permit' | 'deny';
  call?: string;
  digest?: string;
  'exit-action'?: string;
  'lock-token'?: string;
  match?: readonly string[];
  order: string;
  'route-map-id': string;
  set?: readonly string[];
};
/** POST /cluster/sdn/route-maps/entries — `data` payload after client unwrap. */
export type ClusterSdnRouteMapsEntriesPostReturn = null;

/** GET /cluster/sdn/route-maps/entries/{route-map-id} — form/query parameters (path segments omitted). */
export type ClusterSdnRouteMapsEntriesRouteMapIdGetParams = {
  pending?: '0' | '1';
  running?: '0' | '1';
};
/** GET /cluster/sdn/route-maps/entries/{route-map-id} — `data` payload after client unwrap. */
export type ClusterSdnRouteMapsEntriesRouteMapIdGetReturn = readonly ({
  action: 'permit' | 'deny';
  call?: string;
  digest?: string;
  'exit-action'?: string;
  match?: readonly string[];
  order: number;
  'route-map-id': string;
  set?: readonly string[];
} & Record<string, unknown>)[];

/** GET /cluster/sdn/route-maps/entries/{route-map-id}/entry/{order} — `data` payload after client unwrap. */
export type ClusterSdnRouteMapsEntriesRouteMapIdEntryOrderGetReturn = {
  action: 'permit' | 'deny';
  call?: string;
  digest?: string;
  'exit-action'?: string;
  match?: readonly string[];
  order: number;
  'route-map-id': string;
  set?: readonly string[];
} & Record<string, unknown>;

/** PUT /cluster/sdn/route-maps/entries/{route-map-id}/entry/{order} — form/query parameters (path segments omitted). */
export type ClusterSdnRouteMapsEntriesRouteMapIdEntryOrderPutParams = {
  action?: 'permit' | 'deny';
  call?: string;
  delete?: readonly ('set' | 'match' | 'call' | 'exit-action')[];
  digest?: string;
  'exit-action'?: string;
  'lock-token'?: string;
  match?: readonly string[];
  set?: readonly string[];
};
/** PUT /cluster/sdn/route-maps/entries/{route-map-id}/entry/{order} — `data` payload after client unwrap. */
export type ClusterSdnRouteMapsEntriesRouteMapIdEntryOrderPutReturn = null;

/** DELETE /cluster/sdn/route-maps/entries/{route-map-id}/entry/{order} — form/query parameters (path segments omitted). */
export type ClusterSdnRouteMapsEntriesRouteMapIdEntryOrderDeleteParams = { 'lock-token'?: string };
/** DELETE /cluster/sdn/route-maps/entries/{route-map-id}/entry/{order} — `data` payload after client unwrap. */
export type ClusterSdnRouteMapsEntriesRouteMapIdEntryOrderDeleteReturn = null;

/** POST /cluster/sdn/lock — form/query parameters (path segments omitted). */
export type ClusterSdnLockPostParams = { 'allow-pending'?: '0' | '1' };
/** POST /cluster/sdn/lock — `data` payload after client unwrap. */
export type ClusterSdnLockPostReturn = string;

/** DELETE /cluster/sdn/lock — form/query parameters (path segments omitted). */
export type ClusterSdnLockDeleteParams = { force?: '0' | '1'; 'lock-token'?: string };
/** DELETE /cluster/sdn/lock — `data` payload after client unwrap. */
export type ClusterSdnLockDeleteReturn = null;

/** POST /cluster/sdn/rollback — form/query parameters (path segments omitted). */
export type ClusterSdnRollbackPostParams = { 'lock-token'?: string; 'release-lock'?: '0' | '1' };
/** POST /cluster/sdn/rollback — `data` payload after client unwrap. */
export type ClusterSdnRollbackPostReturn = null;

/** GET /cluster/sdn/dry-run — form/query parameters (path segments omitted). */
export type ClusterSdnDryRunGetParams = { node: string };
/** GET /cluster/sdn/dry-run — `data` payload after client unwrap. */
export type ClusterSdnDryRunGetReturn = {
  'frr-diff'?: string;
  'interfaces-diff'?: string;
} & Record<string, unknown>;

/** GET /cluster/status — `data` payload after client unwrap. */
export type ClusterStatusGetReturn = readonly ({
  id: string;
  ip?: string;
  level?: string;
  local?: boolean | 0 | 1;
  name: string;
  nodeid?: number;
  nodes?: number;
  online?: boolean | 0 | 1;
  quorate?: boolean | 0 | 1;
  type: 'cluster' | 'node';
  version?: number;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/qemu — form/query parameters (path segments omitted). */
export type NodesNodeQemuGetParams = { full?: '0' | '1' };
/** GET /nodes/{node}/qemu — `data` payload after client unwrap. */
export type NodesNodeQemuGetReturn = readonly ({
  cpu?: number;
  cpus?: number;
  diskread?: number;
  diskwrite?: number;
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
  status: 'stopped' | 'running';
  tags?: string;
  template?: boolean | 0 | 1;
  uptime?: number;
  vmid: number;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/qemu — form/query parameters (path segments omitted). */
export type NodesNodeQemuPostParams = {
  acpi?: '0' | '1';
  affinity?: string;
  agent?: string;
  'allow-ksm'?: '0' | '1';
  'amd-sev'?: string;
  arch?: 'x86_64' | 'aarch64';
  archive?: string;
  args?: string;
  audio0?: string;
  autostart?: '0' | '1';
  balloon?: string;
  bios?: 'seabios' | 'ovmf';
  boot?: string;
  bootdisk?: string;
  bwlimit?: string;
  cdrom?: string;
  cicustom?: string;
  cipassword?: string;
  citype?: 'configdrive2' | 'nocloud' | 'opennebula';
  ciupgrade?: '0' | '1';
  ciuser?: string;
  cores?: string;
  cpu?: string;
  cpulimit?: string;
  cpuunits?: string;
  description?: string;
  efidisk0?: string;
  force?: '0' | '1';
  freeze?: '0' | '1';
  'ha-managed'?: '0' | '1';
  hookscript?: string;
  'hostpci[n]'?: string;
  hotplug?: string;
  hugepages?: 'any' | '2' | '1024';
  'ide[n]'?: string;
  'import-working-storage'?: string;
  'intel-tdx'?: string;
  'ipconfig[n]'?: string;
  ivshmem?: string;
  keephugepages?: '0' | '1';
  keyboard?:
    | 'de'
    | 'de-ch'
    | 'da'
    | 'en-gb'
    | 'en-us'
    | 'es'
    | 'fi'
    | 'fr'
    | 'fr-be'
    | 'fr-ca'
    | 'fr-ch'
    | 'hu'
    | 'is'
    | 'it'
    | 'ja'
    | 'lt'
    | 'mk'
    | 'nl'
    | 'no'
    | 'pl'
    | 'pt'
    | 'pt-br'
    | 'sv'
    | 'sl'
    | 'tr';
  kvm?: '0' | '1';
  'live-restore'?: '0' | '1';
  localtime?: '0' | '1';
  lock?:
    | 'backup'
    | 'clone'
    | 'create'
    | 'migrate'
    | 'rollback'
    | 'snapshot'
    | 'snapshot-delete'
    | 'suspending'
    | 'suspended';
  machine?: string;
  memory?: string;
  migrate_downtime?: string;
  migrate_speed?: string;
  name?: string;
  nameserver?: string;
  'net[n]'?: string;
  numa?: '0' | '1';
  'numa[n]'?: string;
  onboot?: '0' | '1';
  ostype?:
    | 'other'
    | 'wxp'
    | 'w2k'
    | 'w2k3'
    | 'w2k8'
    | 'wvista'
    | 'win7'
    | 'win8'
    | 'win10'
    | 'win11'
    | 'l24'
    | 'l26'
    | 'solaris';
  'parallel[n]'?: string;
  pool?: string;
  protection?: '0' | '1';
  reboot?: '0' | '1';
  rng0?: string;
  'sata[n]'?: string;
  'scsi[n]'?: string;
  scsihw?: 'lsi' | 'lsi53c810' | 'virtio-scsi-pci' | 'virtio-scsi-single' | 'megasas' | 'pvscsi';
  searchdomain?: string;
  'serial[n]'?: string;
  shares?: string;
  smbios1?: string;
  smp?: string;
  sockets?: string;
  spice_enhancements?: string;
  sshkeys?: string;
  start?: '0' | '1';
  startdate?: string;
  startup?: string;
  storage?: string;
  tablet?: '0' | '1';
  tags?: string;
  tdf?: '0' | '1';
  template?: '0' | '1';
  tpmstate0?: string;
  unique?: '0' | '1';
  'unused[n]'?: string;
  'usb[n]'?: string;
  vcpus?: string;
  vga?: string;
  'virtio[n]'?: string;
  'virtiofs[n]'?: string;
  vmgenid?: string;
  vmid: string;
  vmstatestorage?: string;
  watchdog?: string;
};
/** POST /nodes/{node}/qemu — `data` payload after client unwrap. */
export type NodesNodeQemuPostReturn = string;

/** GET /nodes/{node}/qemu/{vmid} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidGetReturn = readonly ({ subdir: string } & Record<string, unknown>)[];

/** DELETE /nodes/{node}/qemu/{vmid} — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidDeleteParams = {
  'destroy-unreferenced-disks'?: '0' | '1';
  purge?: '0' | '1';
  skiplock?: '0' | '1';
};
/** DELETE /nodes/{node}/qemu/{vmid} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidDeleteReturn = string;

/** GET /nodes/{node}/qemu/{vmid}/firewall — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallGetReturn = readonly Record<string, unknown>[];

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
  enable?: string;
  'icmp-type'?: string;
  iface?: string;
  log?: 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug' | 'nolog';
  macro?: string;
  pos?: string;
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
  enable?: string;
  'icmp-type'?: string;
  iface?: string;
  log?: 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug' | 'nolog';
  macro?: string;
  moveto?: string;
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

/** GET /nodes/{node}/qemu/{vmid}/firewall/aliases — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallAliasesGetReturn = readonly ({
  cidr: string;
  comment?: string;
  digest: string;
  name: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/qemu/{vmid}/firewall/aliases — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallAliasesPostParams = {
  cidr: string;
  comment?: string;
  name: string;
};
/** POST /nodes/{node}/qemu/{vmid}/firewall/aliases — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallAliasesPostReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/firewall/aliases/{name} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallAliasesNameGetReturn = unknown;

/** PUT /nodes/{node}/qemu/{vmid}/firewall/aliases/{name} — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallAliasesNamePutParams = {
  cidr: string;
  comment?: string;
  digest?: string;
  rename?: string;
};
/** PUT /nodes/{node}/qemu/{vmid}/firewall/aliases/{name} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallAliasesNamePutReturn = null;

/** DELETE /nodes/{node}/qemu/{vmid}/firewall/aliases/{name} — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallAliasesNameDeleteParams = { digest?: string };
/** DELETE /nodes/{node}/qemu/{vmid}/firewall/aliases/{name} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallAliasesNameDeleteReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/firewall/ipset — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallIpsetGetReturn = readonly ({
  comment?: string;
  digest: string;
  name: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/qemu/{vmid}/firewall/ipset — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallIpsetPostParams = {
  comment?: string;
  digest?: string;
  name: string;
  rename?: string;
};
/** POST /nodes/{node}/qemu/{vmid}/firewall/ipset — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallIpsetPostReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/firewall/ipset/{name} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallIpsetNameGetReturn = readonly ({
  cidr: string;
  comment?: string;
  digest: string;
  nomatch?: boolean | 0 | 1;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/qemu/{vmid}/firewall/ipset/{name} — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallIpsetNamePostParams = {
  cidr: string;
  comment?: string;
  nomatch?: '0' | '1';
};
/** POST /nodes/{node}/qemu/{vmid}/firewall/ipset/{name} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallIpsetNamePostReturn = null;

/** DELETE /nodes/{node}/qemu/{vmid}/firewall/ipset/{name} — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallIpsetNameDeleteParams = { force?: '0' | '1' };
/** DELETE /nodes/{node}/qemu/{vmid}/firewall/ipset/{name} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallIpsetNameDeleteReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/firewall/ipset/{name}/{cidr} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallIpsetNameCidrGetReturn = unknown;

/** PUT /nodes/{node}/qemu/{vmid}/firewall/ipset/{name}/{cidr} — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallIpsetNameCidrPutParams = {
  comment?: string;
  digest?: string;
  nomatch?: '0' | '1';
};
/** PUT /nodes/{node}/qemu/{vmid}/firewall/ipset/{name}/{cidr} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallIpsetNameCidrPutReturn = null;

/** DELETE /nodes/{node}/qemu/{vmid}/firewall/ipset/{name}/{cidr} — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallIpsetNameCidrDeleteParams = { digest?: string };
/** DELETE /nodes/{node}/qemu/{vmid}/firewall/ipset/{name}/{cidr} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallIpsetNameCidrDeleteReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/firewall/options — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallOptionsGetReturn = {
  dhcp?: boolean | 0 | 1;
  enable?: boolean | 0 | 1;
  ipfilter?: boolean | 0 | 1;
  log_level_in?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  log_level_out?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  macfilter?: boolean | 0 | 1;
  ndp?: boolean | 0 | 1;
  policy_in?: 'ACCEPT' | 'REJECT' | 'DROP';
  policy_out?: 'ACCEPT' | 'REJECT' | 'DROP';
  radv?: boolean | 0 | 1;
} & Record<string, unknown>;

/** PUT /nodes/{node}/qemu/{vmid}/firewall/options — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallOptionsPutParams = {
  delete?: string;
  dhcp?: '0' | '1';
  digest?: string;
  enable?: '0' | '1';
  ipfilter?: '0' | '1';
  log_level_in?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  log_level_out?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  macfilter?: '0' | '1';
  ndp?: '0' | '1';
  policy_in?: 'ACCEPT' | 'REJECT' | 'DROP';
  policy_out?: 'ACCEPT' | 'REJECT' | 'DROP';
  radv?: '0' | '1';
};
/** PUT /nodes/{node}/qemu/{vmid}/firewall/options — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallOptionsPutReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/firewall/log — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallLogGetParams = {
  limit?: string;
  since?: string;
  start?: string;
  until?: string;
};
/** GET /nodes/{node}/qemu/{vmid}/firewall/log — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallLogGetReturn = readonly ({ n: number; t: string } & Record<
  string,
  unknown
>)[];

/** GET /nodes/{node}/qemu/{vmid}/firewall/refs — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallRefsGetParams = { type?: 'alias' | 'ipset' };
/** GET /nodes/{node}/qemu/{vmid}/firewall/refs — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallRefsGetReturn = readonly ({
  comment?: string;
  name: string;
  ref: string;
  scope: string;
  type: 'alias' | 'ipset';
} & Record<string, unknown>)[];

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
export type NodesNodeQemuVmidAgentExecStatusGetParams = { pid: string };
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
  count?: string;
  decode?: '0' | '1';
  file: string;
  offset?: string;
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

/** GET /nodes/{node}/qemu/{vmid}/config — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidConfigGetParams = { current?: '0' | '1'; snapshot?: string };
/** GET /nodes/{node}/qemu/{vmid}/config — `data` payload after client unwrap. */
export type NodesNodeQemuVmidConfigGetReturn = {
  acpi?: boolean | 0 | 1;
  affinity?: string;
  agent?: string;
  'allow-ksm'?: boolean | 0 | 1;
  'amd-sev'?: string;
  arch?: 'x86_64' | 'aarch64';
  args?: string;
  audio0?: string;
  autostart?: boolean | 0 | 1;
  balloon?: number;
  bios?: 'seabios' | 'ovmf';
  boot?: string;
  bootdisk?: string;
  cdrom?: string;
  cicustom?: string;
  cipassword?: string;
  citype?: 'configdrive2' | 'nocloud' | 'opennebula';
  ciupgrade?: boolean | 0 | 1;
  ciuser?: string;
  cores?: number;
  cpu?: string;
  cpulimit?: number;
  cpuunits?: number;
  description?: string;
  digest: string;
  efidisk0?: string;
  freeze?: boolean | 0 | 1;
  hookscript?: string;
  'hostpci[n]'?: string;
  hotplug?: string;
  hugepages?: 'any' | '2' | '1024';
  'ide[n]'?: string;
  'intel-tdx'?: string;
  'ipconfig[n]'?: string;
  ivshmem?: string;
  keephugepages?: boolean | 0 | 1;
  keyboard?:
    | 'de'
    | 'de-ch'
    | 'da'
    | 'en-gb'
    | 'en-us'
    | 'es'
    | 'fi'
    | 'fr'
    | 'fr-be'
    | 'fr-ca'
    | 'fr-ch'
    | 'hu'
    | 'is'
    | 'it'
    | 'ja'
    | 'lt'
    | 'mk'
    | 'nl'
    | 'no'
    | 'pl'
    | 'pt'
    | 'pt-br'
    | 'sv'
    | 'sl'
    | 'tr';
  kvm?: boolean | 0 | 1;
  localtime?: boolean | 0 | 1;
  lock?:
    | 'backup'
    | 'clone'
    | 'create'
    | 'migrate'
    | 'rollback'
    | 'snapshot'
    | 'snapshot-delete'
    | 'suspending'
    | 'suspended';
  machine?: string;
  memory?: string;
  meta?: string;
  migrate_downtime?: number;
  migrate_speed?: number;
  name?: string;
  nameserver?: string;
  'net[n]'?: string;
  numa?: boolean | 0 | 1;
  'numa[n]'?: string;
  onboot?: boolean | 0 | 1;
  ostype?:
    | 'other'
    | 'wxp'
    | 'w2k'
    | 'w2k3'
    | 'w2k8'
    | 'wvista'
    | 'win7'
    | 'win8'
    | 'win10'
    | 'win11'
    | 'l24'
    | 'l26'
    | 'solaris';
  'parallel[n]'?: string;
  parent?: string;
  protection?: boolean | 0 | 1;
  reboot?: boolean | 0 | 1;
  rng0?: string;
  'running-nets-host-mtu'?: string;
  runningcpu?: string;
  runningmachine?: string;
  'sata[n]'?: string;
  'scsi[n]'?: string;
  scsihw?: 'lsi' | 'lsi53c810' | 'virtio-scsi-pci' | 'virtio-scsi-single' | 'megasas' | 'pvscsi';
  searchdomain?: string;
  'serial[n]'?: string;
  shares?: number;
  smbios1?: string;
  smp?: number;
  snaptime?: number;
  sockets?: number;
  spice_enhancements?: string;
  sshkeys?: string;
  startdate?: string;
  startup?: string;
  tablet?: boolean | 0 | 1;
  tags?: string;
  tdf?: boolean | 0 | 1;
  template?: boolean | 0 | 1;
  tpmstate0?: string;
  'unused[n]'?: string;
  'usb[n]'?: string;
  vcpus?: number;
  vga?: string;
  'virtio[n]'?: string;
  'virtiofs[n]'?: string;
  vmgenid?: string;
  vmstate?: string;
  vmstatestorage?: string;
  watchdog?: string;
} & Record<string, unknown>;

/** POST /nodes/{node}/qemu/{vmid}/config — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidConfigPostParams = {
  acpi?: '0' | '1';
  affinity?: string;
  agent?: string;
  'allow-ksm'?: '0' | '1';
  'amd-sev'?: string;
  arch?: 'x86_64' | 'aarch64';
  args?: string;
  audio0?: string;
  autostart?: '0' | '1';
  background_delay?: string;
  balloon?: string;
  bios?: 'seabios' | 'ovmf';
  boot?: string;
  bootdisk?: string;
  cdrom?: string;
  cicustom?: string;
  cipassword?: string;
  citype?: 'configdrive2' | 'nocloud' | 'opennebula';
  ciupgrade?: '0' | '1';
  ciuser?: string;
  cores?: string;
  cpu?: string;
  cpulimit?: string;
  cpuunits?: string;
  delete?: string;
  description?: string;
  digest?: string;
  efidisk0?: string;
  force?: '0' | '1';
  freeze?: '0' | '1';
  hookscript?: string;
  'hostpci[n]'?: string;
  hotplug?: string;
  hugepages?: 'any' | '2' | '1024';
  'ide[n]'?: string;
  'import-working-storage'?: string;
  'intel-tdx'?: string;
  'ipconfig[n]'?: string;
  ivshmem?: string;
  keephugepages?: '0' | '1';
  keyboard?:
    | 'de'
    | 'de-ch'
    | 'da'
    | 'en-gb'
    | 'en-us'
    | 'es'
    | 'fi'
    | 'fr'
    | 'fr-be'
    | 'fr-ca'
    | 'fr-ch'
    | 'hu'
    | 'is'
    | 'it'
    | 'ja'
    | 'lt'
    | 'mk'
    | 'nl'
    | 'no'
    | 'pl'
    | 'pt'
    | 'pt-br'
    | 'sv'
    | 'sl'
    | 'tr';
  kvm?: '0' | '1';
  localtime?: '0' | '1';
  lock?:
    | 'backup'
    | 'clone'
    | 'create'
    | 'migrate'
    | 'rollback'
    | 'snapshot'
    | 'snapshot-delete'
    | 'suspending'
    | 'suspended';
  machine?: string;
  memory?: string;
  migrate_downtime?: string;
  migrate_speed?: string;
  name?: string;
  nameserver?: string;
  'net[n]'?: string;
  numa?: '0' | '1';
  'numa[n]'?: string;
  onboot?: '0' | '1';
  ostype?:
    | 'other'
    | 'wxp'
    | 'w2k'
    | 'w2k3'
    | 'w2k8'
    | 'wvista'
    | 'win7'
    | 'win8'
    | 'win10'
    | 'win11'
    | 'l24'
    | 'l26'
    | 'solaris';
  'parallel[n]'?: string;
  protection?: '0' | '1';
  reboot?: '0' | '1';
  revert?: string;
  rng0?: string;
  'sata[n]'?: string;
  'scsi[n]'?: string;
  scsihw?: 'lsi' | 'lsi53c810' | 'virtio-scsi-pci' | 'virtio-scsi-single' | 'megasas' | 'pvscsi';
  searchdomain?: string;
  'serial[n]'?: string;
  shares?: string;
  skiplock?: '0' | '1';
  smbios1?: string;
  smp?: string;
  sockets?: string;
  spice_enhancements?: string;
  sshkeys?: string;
  startdate?: string;
  startup?: string;
  tablet?: '0' | '1';
  tags?: string;
  tdf?: '0' | '1';
  template?: '0' | '1';
  tpmstate0?: string;
  'unused[n]'?: string;
  'usb[n]'?: string;
  vcpus?: string;
  vga?: string;
  'virtio[n]'?: string;
  'virtiofs[n]'?: string;
  vmgenid?: string;
  vmstatestorage?: string;
  watchdog?: string;
};
/** POST /nodes/{node}/qemu/{vmid}/config — `data` payload after client unwrap. */
export type NodesNodeQemuVmidConfigPostReturn = string;

/** PUT /nodes/{node}/qemu/{vmid}/config — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidConfigPutParams = {
  acpi?: '0' | '1';
  affinity?: string;
  agent?: string;
  'allow-ksm'?: '0' | '1';
  'amd-sev'?: string;
  arch?: 'x86_64' | 'aarch64';
  args?: string;
  audio0?: string;
  autostart?: '0' | '1';
  balloon?: string;
  bios?: 'seabios' | 'ovmf';
  boot?: string;
  bootdisk?: string;
  cdrom?: string;
  cicustom?: string;
  cipassword?: string;
  citype?: 'configdrive2' | 'nocloud' | 'opennebula';
  ciupgrade?: '0' | '1';
  ciuser?: string;
  cores?: string;
  cpu?: string;
  cpulimit?: string;
  cpuunits?: string;
  delete?: string;
  description?: string;
  digest?: string;
  efidisk0?: string;
  force?: '0' | '1';
  freeze?: '0' | '1';
  hookscript?: string;
  'hostpci[n]'?: string;
  hotplug?: string;
  hugepages?: 'any' | '2' | '1024';
  'ide[n]'?: string;
  'intel-tdx'?: string;
  'ipconfig[n]'?: string;
  ivshmem?: string;
  keephugepages?: '0' | '1';
  keyboard?:
    | 'de'
    | 'de-ch'
    | 'da'
    | 'en-gb'
    | 'en-us'
    | 'es'
    | 'fi'
    | 'fr'
    | 'fr-be'
    | 'fr-ca'
    | 'fr-ch'
    | 'hu'
    | 'is'
    | 'it'
    | 'ja'
    | 'lt'
    | 'mk'
    | 'nl'
    | 'no'
    | 'pl'
    | 'pt'
    | 'pt-br'
    | 'sv'
    | 'sl'
    | 'tr';
  kvm?: '0' | '1';
  localtime?: '0' | '1';
  lock?:
    | 'backup'
    | 'clone'
    | 'create'
    | 'migrate'
    | 'rollback'
    | 'snapshot'
    | 'snapshot-delete'
    | 'suspending'
    | 'suspended';
  machine?: string;
  memory?: string;
  migrate_downtime?: string;
  migrate_speed?: string;
  name?: string;
  nameserver?: string;
  'net[n]'?: string;
  numa?: '0' | '1';
  'numa[n]'?: string;
  onboot?: '0' | '1';
  ostype?:
    | 'other'
    | 'wxp'
    | 'w2k'
    | 'w2k3'
    | 'w2k8'
    | 'wvista'
    | 'win7'
    | 'win8'
    | 'win10'
    | 'win11'
    | 'l24'
    | 'l26'
    | 'solaris';
  'parallel[n]'?: string;
  protection?: '0' | '1';
  reboot?: '0' | '1';
  revert?: string;
  rng0?: string;
  'sata[n]'?: string;
  'scsi[n]'?: string;
  scsihw?: 'lsi' | 'lsi53c810' | 'virtio-scsi-pci' | 'virtio-scsi-single' | 'megasas' | 'pvscsi';
  searchdomain?: string;
  'serial[n]'?: string;
  shares?: string;
  skiplock?: '0' | '1';
  smbios1?: string;
  smp?: string;
  sockets?: string;
  spice_enhancements?: string;
  sshkeys?: string;
  startdate?: string;
  startup?: string;
  tablet?: '0' | '1';
  tags?: string;
  tdf?: '0' | '1';
  template?: '0' | '1';
  tpmstate0?: string;
  'unused[n]'?: string;
  'usb[n]'?: string;
  vcpus?: string;
  vga?: string;
  'virtio[n]'?: string;
  'virtiofs[n]'?: string;
  vmgenid?: string;
  vmstatestorage?: string;
  watchdog?: string;
};
/** PUT /nodes/{node}/qemu/{vmid}/config — `data` payload after client unwrap. */
export type NodesNodeQemuVmidConfigPutReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/pending — `data` payload after client unwrap. */
export type NodesNodeQemuVmidPendingGetReturn = readonly ({
  delete?: number;
  key: string;
  pending?: string;
  value?: string;
} & Record<string, unknown>)[];

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

/** GET /nodes/{node}/qemu/{vmid}/vncwebsocket — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidVncwebsocketGetParams = { port: string; vncticket: string };
/** GET /nodes/{node}/qemu/{vmid}/vncwebsocket — `data` payload after client unwrap. */
export type NodesNodeQemuVmidVncwebsocketGetReturn = { port: string } & Record<string, unknown>;

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

/** GET /nodes/{node}/qemu/{vmid}/status — `data` payload after client unwrap. */
export type NodesNodeQemuVmidStatusGetReturn = readonly ({ subdir: string } & Record<
  string,
  unknown
>)[];

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
  timeout?: string;
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
  timeout?: string;
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
  timeout?: string;
};
/** POST /nodes/{node}/qemu/{vmid}/status/shutdown — `data` payload after client unwrap. */
export type NodesNodeQemuVmidStatusShutdownPostReturn = string;

/** POST /nodes/{node}/qemu/{vmid}/status/reboot — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidStatusRebootPostParams = { timeout?: string };
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

/** PUT /nodes/{node}/qemu/{vmid}/sendkey — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidSendkeyPutParams = { key: string; skiplock?: '0' | '1' };
/** PUT /nodes/{node}/qemu/{vmid}/sendkey — `data` payload after client unwrap. */
export type NodesNodeQemuVmidSendkeyPutReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/feature — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFeatureGetParams = {
  feature: 'snapshot' | 'clone' | 'copy';
  snapname?: string;
};
/** GET /nodes/{node}/qemu/{vmid}/feature — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFeatureGetReturn = {
  hasFeature: boolean | 0 | 1;
  nodes: readonly string[];
} & Record<string, unknown>;

/** POST /nodes/{node}/qemu/{vmid}/clone — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidClonePostParams = {
  bwlimit?: string;
  description?: string;
  format?: 'raw' | 'qcow2' | 'vmdk';
  full?: '0' | '1';
  name?: string;
  newid: string;
  pool?: string;
  snapname?: string;
  storage?: string;
  target?: string;
};
/** POST /nodes/{node}/qemu/{vmid}/clone — `data` payload after client unwrap. */
export type NodesNodeQemuVmidClonePostReturn = string;

/** POST /nodes/{node}/qemu/{vmid}/move_disk — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidMove_diskPostParams = {
  bwlimit?: string;
  delete?: '0' | '1';
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
    | 'tpmstate0'
    | 'unused0'
    | 'unused1'
    | 'unused2'
    | 'unused3'
    | 'unused4'
    | 'unused5'
    | 'unused6'
    | 'unused7'
    | 'unused8'
    | 'unused9'
    | 'unused10'
    | 'unused11'
    | 'unused12'
    | 'unused13'
    | 'unused14'
    | 'unused15'
    | 'unused16'
    | 'unused17'
    | 'unused18'
    | 'unused19'
    | 'unused20'
    | 'unused21'
    | 'unused22'
    | 'unused23'
    | 'unused24'
    | 'unused25'
    | 'unused26'
    | 'unused27'
    | 'unused28'
    | 'unused29'
    | 'unused30'
    | 'unused31'
    | 'unused32'
    | 'unused33'
    | 'unused34'
    | 'unused35'
    | 'unused36'
    | 'unused37'
    | 'unused38'
    | 'unused39'
    | 'unused40'
    | 'unused41'
    | 'unused42'
    | 'unused43'
    | 'unused44'
    | 'unused45'
    | 'unused46'
    | 'unused47'
    | 'unused48'
    | 'unused49'
    | 'unused50'
    | 'unused51'
    | 'unused52'
    | 'unused53'
    | 'unused54'
    | 'unused55'
    | 'unused56'
    | 'unused57'
    | 'unused58'
    | 'unused59'
    | 'unused60'
    | 'unused61'
    | 'unused62'
    | 'unused63'
    | 'unused64'
    | 'unused65'
    | 'unused66'
    | 'unused67'
    | 'unused68'
    | 'unused69'
    | 'unused70'
    | 'unused71'
    | 'unused72'
    | 'unused73'
    | 'unused74'
    | 'unused75'
    | 'unused76'
    | 'unused77'
    | 'unused78'
    | 'unused79'
    | 'unused80'
    | 'unused81'
    | 'unused82'
    | 'unused83'
    | 'unused84'
    | 'unused85'
    | 'unused86'
    | 'unused87'
    | 'unused88'
    | 'unused89'
    | 'unused90'
    | 'unused91'
    | 'unused92'
    | 'unused93'
    | 'unused94'
    | 'unused95'
    | 'unused96'
    | 'unused97'
    | 'unused98'
    | 'unused99'
    | 'unused100'
    | 'unused101'
    | 'unused102'
    | 'unused103'
    | 'unused104'
    | 'unused105'
    | 'unused106'
    | 'unused107'
    | 'unused108'
    | 'unused109'
    | 'unused110'
    | 'unused111'
    | 'unused112'
    | 'unused113'
    | 'unused114'
    | 'unused115'
    | 'unused116'
    | 'unused117'
    | 'unused118'
    | 'unused119'
    | 'unused120'
    | 'unused121'
    | 'unused122'
    | 'unused123'
    | 'unused124'
    | 'unused125'
    | 'unused126'
    | 'unused127'
    | 'unused128'
    | 'unused129'
    | 'unused130'
    | 'unused131'
    | 'unused132'
    | 'unused133'
    | 'unused134'
    | 'unused135'
    | 'unused136'
    | 'unused137'
    | 'unused138'
    | 'unused139'
    | 'unused140'
    | 'unused141'
    | 'unused142'
    | 'unused143'
    | 'unused144'
    | 'unused145'
    | 'unused146'
    | 'unused147'
    | 'unused148'
    | 'unused149'
    | 'unused150'
    | 'unused151'
    | 'unused152'
    | 'unused153'
    | 'unused154'
    | 'unused155'
    | 'unused156'
    | 'unused157'
    | 'unused158'
    | 'unused159'
    | 'unused160'
    | 'unused161'
    | 'unused162'
    | 'unused163'
    | 'unused164'
    | 'unused165'
    | 'unused166'
    | 'unused167'
    | 'unused168'
    | 'unused169'
    | 'unused170'
    | 'unused171'
    | 'unused172'
    | 'unused173'
    | 'unused174'
    | 'unused175'
    | 'unused176'
    | 'unused177'
    | 'unused178'
    | 'unused179'
    | 'unused180'
    | 'unused181'
    | 'unused182'
    | 'unused183'
    | 'unused184'
    | 'unused185'
    | 'unused186'
    | 'unused187'
    | 'unused188'
    | 'unused189'
    | 'unused190'
    | 'unused191'
    | 'unused192'
    | 'unused193'
    | 'unused194'
    | 'unused195'
    | 'unused196'
    | 'unused197'
    | 'unused198'
    | 'unused199'
    | 'unused200'
    | 'unused201'
    | 'unused202'
    | 'unused203'
    | 'unused204'
    | 'unused205'
    | 'unused206'
    | 'unused207'
    | 'unused208'
    | 'unused209'
    | 'unused210'
    | 'unused211'
    | 'unused212'
    | 'unused213'
    | 'unused214'
    | 'unused215'
    | 'unused216'
    | 'unused217'
    | 'unused218'
    | 'unused219'
    | 'unused220'
    | 'unused221'
    | 'unused222'
    | 'unused223'
    | 'unused224'
    | 'unused225'
    | 'unused226'
    | 'unused227'
    | 'unused228'
    | 'unused229'
    | 'unused230'
    | 'unused231'
    | 'unused232'
    | 'unused233'
    | 'unused234'
    | 'unused235'
    | 'unused236'
    | 'unused237'
    | 'unused238'
    | 'unused239'
    | 'unused240'
    | 'unused241'
    | 'unused242'
    | 'unused243'
    | 'unused244'
    | 'unused245'
    | 'unused246'
    | 'unused247'
    | 'unused248'
    | 'unused249'
    | 'unused250'
    | 'unused251'
    | 'unused252'
    | 'unused253'
    | 'unused254'
    | 'unused255';
  format?: 'raw' | 'qcow2' | 'vmdk';
  storage?: string;
  'target-digest'?: string;
  'target-disk'?:
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
    | 'tpmstate0'
    | 'unused0'
    | 'unused1'
    | 'unused2'
    | 'unused3'
    | 'unused4'
    | 'unused5'
    | 'unused6'
    | 'unused7'
    | 'unused8'
    | 'unused9'
    | 'unused10'
    | 'unused11'
    | 'unused12'
    | 'unused13'
    | 'unused14'
    | 'unused15'
    | 'unused16'
    | 'unused17'
    | 'unused18'
    | 'unused19'
    | 'unused20'
    | 'unused21'
    | 'unused22'
    | 'unused23'
    | 'unused24'
    | 'unused25'
    | 'unused26'
    | 'unused27'
    | 'unused28'
    | 'unused29'
    | 'unused30'
    | 'unused31'
    | 'unused32'
    | 'unused33'
    | 'unused34'
    | 'unused35'
    | 'unused36'
    | 'unused37'
    | 'unused38'
    | 'unused39'
    | 'unused40'
    | 'unused41'
    | 'unused42'
    | 'unused43'
    | 'unused44'
    | 'unused45'
    | 'unused46'
    | 'unused47'
    | 'unused48'
    | 'unused49'
    | 'unused50'
    | 'unused51'
    | 'unused52'
    | 'unused53'
    | 'unused54'
    | 'unused55'
    | 'unused56'
    | 'unused57'
    | 'unused58'
    | 'unused59'
    | 'unused60'
    | 'unused61'
    | 'unused62'
    | 'unused63'
    | 'unused64'
    | 'unused65'
    | 'unused66'
    | 'unused67'
    | 'unused68'
    | 'unused69'
    | 'unused70'
    | 'unused71'
    | 'unused72'
    | 'unused73'
    | 'unused74'
    | 'unused75'
    | 'unused76'
    | 'unused77'
    | 'unused78'
    | 'unused79'
    | 'unused80'
    | 'unused81'
    | 'unused82'
    | 'unused83'
    | 'unused84'
    | 'unused85'
    | 'unused86'
    | 'unused87'
    | 'unused88'
    | 'unused89'
    | 'unused90'
    | 'unused91'
    | 'unused92'
    | 'unused93'
    | 'unused94'
    | 'unused95'
    | 'unused96'
    | 'unused97'
    | 'unused98'
    | 'unused99'
    | 'unused100'
    | 'unused101'
    | 'unused102'
    | 'unused103'
    | 'unused104'
    | 'unused105'
    | 'unused106'
    | 'unused107'
    | 'unused108'
    | 'unused109'
    | 'unused110'
    | 'unused111'
    | 'unused112'
    | 'unused113'
    | 'unused114'
    | 'unused115'
    | 'unused116'
    | 'unused117'
    | 'unused118'
    | 'unused119'
    | 'unused120'
    | 'unused121'
    | 'unused122'
    | 'unused123'
    | 'unused124'
    | 'unused125'
    | 'unused126'
    | 'unused127'
    | 'unused128'
    | 'unused129'
    | 'unused130'
    | 'unused131'
    | 'unused132'
    | 'unused133'
    | 'unused134'
    | 'unused135'
    | 'unused136'
    | 'unused137'
    | 'unused138'
    | 'unused139'
    | 'unused140'
    | 'unused141'
    | 'unused142'
    | 'unused143'
    | 'unused144'
    | 'unused145'
    | 'unused146'
    | 'unused147'
    | 'unused148'
    | 'unused149'
    | 'unused150'
    | 'unused151'
    | 'unused152'
    | 'unused153'
    | 'unused154'
    | 'unused155'
    | 'unused156'
    | 'unused157'
    | 'unused158'
    | 'unused159'
    | 'unused160'
    | 'unused161'
    | 'unused162'
    | 'unused163'
    | 'unused164'
    | 'unused165'
    | 'unused166'
    | 'unused167'
    | 'unused168'
    | 'unused169'
    | 'unused170'
    | 'unused171'
    | 'unused172'
    | 'unused173'
    | 'unused174'
    | 'unused175'
    | 'unused176'
    | 'unused177'
    | 'unused178'
    | 'unused179'
    | 'unused180'
    | 'unused181'
    | 'unused182'
    | 'unused183'
    | 'unused184'
    | 'unused185'
    | 'unused186'
    | 'unused187'
    | 'unused188'
    | 'unused189'
    | 'unused190'
    | 'unused191'
    | 'unused192'
    | 'unused193'
    | 'unused194'
    | 'unused195'
    | 'unused196'
    | 'unused197'
    | 'unused198'
    | 'unused199'
    | 'unused200'
    | 'unused201'
    | 'unused202'
    | 'unused203'
    | 'unused204'
    | 'unused205'
    | 'unused206'
    | 'unused207'
    | 'unused208'
    | 'unused209'
    | 'unused210'
    | 'unused211'
    | 'unused212'
    | 'unused213'
    | 'unused214'
    | 'unused215'
    | 'unused216'
    | 'unused217'
    | 'unused218'
    | 'unused219'
    | 'unused220'
    | 'unused221'
    | 'unused222'
    | 'unused223'
    | 'unused224'
    | 'unused225'
    | 'unused226'
    | 'unused227'
    | 'unused228'
    | 'unused229'
    | 'unused230'
    | 'unused231'
    | 'unused232'
    | 'unused233'
    | 'unused234'
    | 'unused235'
    | 'unused236'
    | 'unused237'
    | 'unused238'
    | 'unused239'
    | 'unused240'
    | 'unused241'
    | 'unused242'
    | 'unused243'
    | 'unused244'
    | 'unused245'
    | 'unused246'
    | 'unused247'
    | 'unused248'
    | 'unused249'
    | 'unused250'
    | 'unused251'
    | 'unused252'
    | 'unused253'
    | 'unused254'
    | 'unused255';
  'target-vmid'?: string;
};
/** POST /nodes/{node}/qemu/{vmid}/move_disk — `data` payload after client unwrap. */
export type NodesNodeQemuVmidMove_diskPostReturn = string;

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
  bwlimit?: string;
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

/** POST /nodes/{node}/qemu/{vmid}/remote_migrate — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidRemote_migratePostParams = {
  bwlimit?: string;
  delete?: '0' | '1';
  online?: '0' | '1';
  'target-bridge': string;
  'target-endpoint': string;
  'target-storage': string;
  'target-vmid'?: string;
};
/** POST /nodes/{node}/qemu/{vmid}/remote_migrate — `data` payload after client unwrap. */
export type NodesNodeQemuVmidRemote_migratePostReturn = string;

/** POST /nodes/{node}/qemu/{vmid}/monitor — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidMonitorPostParams = { command: string };
/** POST /nodes/{node}/qemu/{vmid}/monitor — `data` payload after client unwrap. */
export type NodesNodeQemuVmidMonitorPostReturn = string;

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

/** POST /nodes/{node}/qemu/{vmid}/dbus-vmstate — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidDbusVmstatePostParams = { action: 'start' | 'stop' };
/** POST /nodes/{node}/qemu/{vmid}/dbus-vmstate — `data` payload after client unwrap. */
export type NodesNodeQemuVmidDbusVmstatePostReturn = null;

/** GET /nodes/{node}/lxc — `data` payload after client unwrap. */
export type NodesNodeLxcGetReturn = readonly ({
  cpu?: number;
  cpus?: number;
  disk?: number;
  diskread?: number;
  diskwrite?: number;
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
} & Record<string, unknown>)[];

/** POST /nodes/{node}/lxc — form/query parameters (path segments omitted). */
export type NodesNodeLxcPostParams = {
  arch?: 'amd64' | 'i386' | 'arm64' | 'armhf' | 'riscv32' | 'riscv64';
  bwlimit?: string;
  cmode?: 'shell' | 'console' | 'tty';
  console?: '0' | '1';
  cores?: string;
  cpulimit?: string;
  cpuunits?: string;
  debug?: '0' | '1';
  description?: string;
  'dev[n]'?: string;
  entrypoint?: string;
  env?: string;
  features?: string;
  force?: '0' | '1';
  'ha-managed'?: '0' | '1';
  hookscript?: string;
  hostname?: string;
  'ignore-unpack-errors'?: '0' | '1';
  lock?:
    | 'backup'
    | 'create'
    | 'destroyed'
    | 'disk'
    | 'fstrim'
    | 'migrate'
    | 'mounted'
    | 'rollback'
    | 'snapshot'
    | 'snapshot-delete';
  memory?: string;
  'mp[n]'?: string;
  nameserver?: string;
  'net[n]'?: string;
  onboot?: '0' | '1';
  ostemplate: string;
  ostype?:
    | 'debian'
    | 'devuan'
    | 'ubuntu'
    | 'centos'
    | 'fedora'
    | 'opensuse'
    | 'archlinux'
    | 'alpine'
    | 'gentoo'
    | 'nixos'
    | 'unmanaged';
  password?: string;
  pool?: string;
  protection?: '0' | '1';
  restore?: '0' | '1';
  rootfs?: string;
  searchdomain?: string;
  'ssh-public-keys'?: string;
  start?: '0' | '1';
  startup?: string;
  storage?: string;
  swap?: string;
  tags?: string;
  template?: '0' | '1';
  timezone?: string;
  tty?: string;
  unique?: '0' | '1';
  unprivileged?: '0' | '1';
  'unused[n]'?: string;
  vmid: string;
};
/** POST /nodes/{node}/lxc — `data` payload after client unwrap. */
export type NodesNodeLxcPostReturn = string;

/** GET /nodes/{node}/lxc/{vmid} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidGetReturn = readonly ({ subdir: string } & Record<string, unknown>)[];

/** DELETE /nodes/{node}/lxc/{vmid} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidDeleteParams = {
  'destroy-unreferenced-disks'?: '0' | '1';
  force?: '0' | '1';
  purge?: '0' | '1';
};
/** DELETE /nodes/{node}/lxc/{vmid} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidDeleteReturn = string;

/** GET /nodes/{node}/lxc/{vmid}/config — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidConfigGetParams = { current?: '0' | '1'; snapshot?: string };
/** GET /nodes/{node}/lxc/{vmid}/config — `data` payload after client unwrap. */
export type NodesNodeLxcVmidConfigGetReturn = {
  arch?: 'amd64' | 'i386' | 'arm64' | 'armhf' | 'riscv32' | 'riscv64';
  cmode?: 'shell' | 'console' | 'tty';
  console?: boolean | 0 | 1;
  cores?: number;
  cpulimit?: number;
  cpuunits?: number;
  debug?: boolean | 0 | 1;
  description?: string;
  'dev[n]'?: string;
  digest: string;
  entrypoint?: string;
  env?: string;
  features?: string;
  hookscript?: string;
  hostname?: string;
  lock?:
    | 'backup'
    | 'create'
    | 'destroyed'
    | 'disk'
    | 'fstrim'
    | 'migrate'
    | 'mounted'
    | 'rollback'
    | 'snapshot'
    | 'snapshot-delete';
  lxc?: readonly string[][];
  memory?: number;
  'mp[n]'?: string;
  nameserver?: string;
  'net[n]'?: string;
  onboot?: boolean | 0 | 1;
  ostype?:
    | 'debian'
    | 'devuan'
    | 'ubuntu'
    | 'centos'
    | 'fedora'
    | 'opensuse'
    | 'archlinux'
    | 'alpine'
    | 'gentoo'
    | 'nixos'
    | 'unmanaged';
  protection?: boolean | 0 | 1;
  rootfs?: string;
  searchdomain?: string;
  startup?: string;
  swap?: number;
  tags?: string;
  template?: boolean | 0 | 1;
  timezone?: string;
  tty?: number;
  unprivileged?: boolean | 0 | 1;
  'unused[n]'?: string;
} & Record<string, unknown>;

/** PUT /nodes/{node}/lxc/{vmid}/config — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidConfigPutParams = {
  arch?: 'amd64' | 'i386' | 'arm64' | 'armhf' | 'riscv32' | 'riscv64';
  cmode?: 'shell' | 'console' | 'tty';
  console?: '0' | '1';
  cores?: string;
  cpulimit?: string;
  cpuunits?: string;
  debug?: '0' | '1';
  delete?: string;
  description?: string;
  'dev[n]'?: string;
  digest?: string;
  entrypoint?: string;
  env?: string;
  features?: string;
  hookscript?: string;
  hostname?: string;
  lock?:
    | 'backup'
    | 'create'
    | 'destroyed'
    | 'disk'
    | 'fstrim'
    | 'migrate'
    | 'mounted'
    | 'rollback'
    | 'snapshot'
    | 'snapshot-delete';
  memory?: string;
  'mp[n]'?: string;
  nameserver?: string;
  'net[n]'?: string;
  onboot?: '0' | '1';
  ostype?:
    | 'debian'
    | 'devuan'
    | 'ubuntu'
    | 'centos'
    | 'fedora'
    | 'opensuse'
    | 'archlinux'
    | 'alpine'
    | 'gentoo'
    | 'nixos'
    | 'unmanaged';
  protection?: '0' | '1';
  revert?: string;
  rootfs?: string;
  searchdomain?: string;
  startup?: string;
  swap?: string;
  tags?: string;
  template?: '0' | '1';
  timezone?: string;
  tty?: string;
  unprivileged?: '0' | '1';
  'unused[n]'?: string;
};
/** PUT /nodes/{node}/lxc/{vmid}/config — `data` payload after client unwrap. */
export type NodesNodeLxcVmidConfigPutReturn = null;

/** GET /nodes/{node}/lxc/{vmid}/status — `data` payload after client unwrap. */
export type NodesNodeLxcVmidStatusGetReturn = readonly ({ subdir: string } & Record<
  string,
  unknown
>)[];

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
export type NodesNodeLxcVmidStatusShutdownPostParams = { forceStop?: '0' | '1'; timeout?: string };
/** POST /nodes/{node}/lxc/{vmid}/status/shutdown — `data` payload after client unwrap. */
export type NodesNodeLxcVmidStatusShutdownPostReturn = string;

/** POST /nodes/{node}/lxc/{vmid}/status/suspend — `data` payload after client unwrap. */
export type NodesNodeLxcVmidStatusSuspendPostReturn = string;

/** POST /nodes/{node}/lxc/{vmid}/status/resume — `data` payload after client unwrap. */
export type NodesNodeLxcVmidStatusResumePostReturn = string;

/** POST /nodes/{node}/lxc/{vmid}/status/reboot — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidStatusRebootPostParams = { timeout?: string };
/** POST /nodes/{node}/lxc/{vmid}/status/reboot — `data` payload after client unwrap. */
export type NodesNodeLxcVmidStatusRebootPostReturn = string;

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

/** GET /nodes/{node}/lxc/{vmid}/firewall — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallGetReturn = readonly Record<string, unknown>[];

/** GET /nodes/{node}/lxc/{vmid}/firewall/rules — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallRulesGetReturn = readonly ({
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

/** POST /nodes/{node}/lxc/{vmid}/firewall/rules — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallRulesPostParams = {
  action: string;
  comment?: string;
  dest?: string;
  digest?: string;
  dport?: string;
  enable?: string;
  'icmp-type'?: string;
  iface?: string;
  log?: 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug' | 'nolog';
  macro?: string;
  pos?: string;
  proto?: string;
  source?: string;
  sport?: string;
  type: 'in' | 'out' | 'forward' | 'group';
};
/** POST /nodes/{node}/lxc/{vmid}/firewall/rules — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallRulesPostReturn = null;

/** GET /nodes/{node}/lxc/{vmid}/firewall/rules/{pos} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallRulesPosGetReturn = {
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

/** PUT /nodes/{node}/lxc/{vmid}/firewall/rules/{pos} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallRulesPosPutParams = {
  action?: string;
  comment?: string;
  delete?: string;
  dest?: string;
  digest?: string;
  dport?: string;
  enable?: string;
  'icmp-type'?: string;
  iface?: string;
  log?: 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug' | 'nolog';
  macro?: string;
  moveto?: string;
  proto?: string;
  source?: string;
  sport?: string;
  type?: 'in' | 'out' | 'forward' | 'group';
};
/** PUT /nodes/{node}/lxc/{vmid}/firewall/rules/{pos} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallRulesPosPutReturn = null;

/** DELETE /nodes/{node}/lxc/{vmid}/firewall/rules/{pos} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallRulesPosDeleteParams = { digest?: string };
/** DELETE /nodes/{node}/lxc/{vmid}/firewall/rules/{pos} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallRulesPosDeleteReturn = null;

/** GET /nodes/{node}/lxc/{vmid}/firewall/aliases — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallAliasesGetReturn = readonly ({
  cidr: string;
  comment?: string;
  digest: string;
  name: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/lxc/{vmid}/firewall/aliases — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallAliasesPostParams = {
  cidr: string;
  comment?: string;
  name: string;
};
/** POST /nodes/{node}/lxc/{vmid}/firewall/aliases — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallAliasesPostReturn = null;

/** GET /nodes/{node}/lxc/{vmid}/firewall/aliases/{name} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallAliasesNameGetReturn = unknown;

/** PUT /nodes/{node}/lxc/{vmid}/firewall/aliases/{name} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallAliasesNamePutParams = {
  cidr: string;
  comment?: string;
  digest?: string;
  rename?: string;
};
/** PUT /nodes/{node}/lxc/{vmid}/firewall/aliases/{name} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallAliasesNamePutReturn = null;

/** DELETE /nodes/{node}/lxc/{vmid}/firewall/aliases/{name} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallAliasesNameDeleteParams = { digest?: string };
/** DELETE /nodes/{node}/lxc/{vmid}/firewall/aliases/{name} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallAliasesNameDeleteReturn = null;

/** GET /nodes/{node}/lxc/{vmid}/firewall/ipset — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallIpsetGetReturn = readonly ({
  comment?: string;
  digest: string;
  name: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/lxc/{vmid}/firewall/ipset — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallIpsetPostParams = {
  comment?: string;
  digest?: string;
  name: string;
  rename?: string;
};
/** POST /nodes/{node}/lxc/{vmid}/firewall/ipset — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallIpsetPostReturn = null;

/** GET /nodes/{node}/lxc/{vmid}/firewall/ipset/{name} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallIpsetNameGetReturn = readonly ({
  cidr: string;
  comment?: string;
  digest: string;
  nomatch?: boolean | 0 | 1;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/lxc/{vmid}/firewall/ipset/{name} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallIpsetNamePostParams = {
  cidr: string;
  comment?: string;
  nomatch?: '0' | '1';
};
/** POST /nodes/{node}/lxc/{vmid}/firewall/ipset/{name} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallIpsetNamePostReturn = null;

/** DELETE /nodes/{node}/lxc/{vmid}/firewall/ipset/{name} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallIpsetNameDeleteParams = { force?: '0' | '1' };
/** DELETE /nodes/{node}/lxc/{vmid}/firewall/ipset/{name} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallIpsetNameDeleteReturn = null;

/** GET /nodes/{node}/lxc/{vmid}/firewall/ipset/{name}/{cidr} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallIpsetNameCidrGetReturn = unknown;

/** PUT /nodes/{node}/lxc/{vmid}/firewall/ipset/{name}/{cidr} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallIpsetNameCidrPutParams = {
  comment?: string;
  digest?: string;
  nomatch?: '0' | '1';
};
/** PUT /nodes/{node}/lxc/{vmid}/firewall/ipset/{name}/{cidr} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallIpsetNameCidrPutReturn = null;

/** DELETE /nodes/{node}/lxc/{vmid}/firewall/ipset/{name}/{cidr} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallIpsetNameCidrDeleteParams = { digest?: string };
/** DELETE /nodes/{node}/lxc/{vmid}/firewall/ipset/{name}/{cidr} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallIpsetNameCidrDeleteReturn = null;

/** GET /nodes/{node}/lxc/{vmid}/firewall/options — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallOptionsGetReturn = {
  dhcp?: boolean | 0 | 1;
  enable?: boolean | 0 | 1;
  ipfilter?: boolean | 0 | 1;
  log_level_in?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  log_level_out?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  macfilter?: boolean | 0 | 1;
  ndp?: boolean | 0 | 1;
  policy_in?: 'ACCEPT' | 'REJECT' | 'DROP';
  policy_out?: 'ACCEPT' | 'REJECT' | 'DROP';
  radv?: boolean | 0 | 1;
} & Record<string, unknown>;

/** PUT /nodes/{node}/lxc/{vmid}/firewall/options — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallOptionsPutParams = {
  delete?: string;
  dhcp?: '0' | '1';
  digest?: string;
  enable?: '0' | '1';
  ipfilter?: '0' | '1';
  log_level_in?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  log_level_out?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  macfilter?: '0' | '1';
  ndp?: '0' | '1';
  policy_in?: 'ACCEPT' | 'REJECT' | 'DROP';
  policy_out?: 'ACCEPT' | 'REJECT' | 'DROP';
  radv?: '0' | '1';
};
/** PUT /nodes/{node}/lxc/{vmid}/firewall/options — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallOptionsPutReturn = null;

/** GET /nodes/{node}/lxc/{vmid}/firewall/log — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallLogGetParams = {
  limit?: string;
  since?: string;
  start?: string;
  until?: string;
};
/** GET /nodes/{node}/lxc/{vmid}/firewall/log — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallLogGetReturn = readonly ({ n: number; t: string } & Record<
  string,
  unknown
>)[];

/** GET /nodes/{node}/lxc/{vmid}/firewall/refs — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallRefsGetParams = { type?: 'alias' | 'ipset' };
/** GET /nodes/{node}/lxc/{vmid}/firewall/refs — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallRefsGetReturn = readonly ({
  comment?: string;
  name: string;
  ref: string;
  scope: string;
  type: 'alias' | 'ipset';
} & Record<string, unknown>)[];

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

/** POST /nodes/{node}/lxc/{vmid}/vncproxy — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidVncproxyPostParams = {
  height?: string;
  websocket?: '0' | '1';
  width?: string;
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

/** POST /nodes/{node}/lxc/{vmid}/termproxy — `data` payload after client unwrap. */
export type NodesNodeLxcVmidTermproxyPostReturn = {
  port: number;
  ticket: string;
  upid: string;
  user: string;
};

/** GET /nodes/{node}/lxc/{vmid}/vncwebsocket — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidVncwebsocketGetParams = { port: string; vncticket: string };
/** GET /nodes/{node}/lxc/{vmid}/vncwebsocket — `data` payload after client unwrap. */
export type NodesNodeLxcVmidVncwebsocketGetReturn = { port: string } & Record<string, unknown>;

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

/** POST /nodes/{node}/lxc/{vmid}/remote_migrate — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidRemote_migratePostParams = {
  bwlimit?: string;
  delete?: '0' | '1';
  online?: '0' | '1';
  restart?: '0' | '1';
  'target-bridge': string;
  'target-endpoint': string;
  'target-storage': string;
  'target-vmid'?: string;
  timeout?: string;
};
/** POST /nodes/{node}/lxc/{vmid}/remote_migrate — `data` payload after client unwrap. */
export type NodesNodeLxcVmidRemote_migratePostReturn = string;

/** GET /nodes/{node}/lxc/{vmid}/migrate — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidMigrateGetParams = { target?: string };
/** GET /nodes/{node}/lxc/{vmid}/migrate — `data` payload after client unwrap. */
export type NodesNodeLxcVmidMigrateGetReturn = {
  'allowed-nodes'?: readonly string[];
  'dependent-ha-resources'?: readonly string[];
  'not-allowed-nodes'?: {
    'blocking-ha-resources'?: readonly ({
      cause: 'node-affinity' | 'resource-affinity';
      sid: string;
    } & Record<string, unknown>)[];
  } & Record<string, unknown>;
  running: boolean | 0 | 1;
} & Record<string, unknown>;

/** POST /nodes/{node}/lxc/{vmid}/migrate — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidMigratePostParams = {
  bwlimit?: string;
  online?: '0' | '1';
  restart?: '0' | '1';
  target: string;
  'target-storage'?: string;
  timeout?: string;
};
/** POST /nodes/{node}/lxc/{vmid}/migrate — `data` payload after client unwrap. */
export type NodesNodeLxcVmidMigratePostReturn = string;

/** GET /nodes/{node}/lxc/{vmid}/feature — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFeatureGetParams = {
  feature: 'snapshot' | 'clone' | 'copy';
  snapname?: string;
};
/** GET /nodes/{node}/lxc/{vmid}/feature — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFeatureGetReturn = { hasFeature: boolean | 0 | 1 } & Record<
  string,
  unknown
>;

/** POST /nodes/{node}/lxc/{vmid}/template — `data` payload after client unwrap. */
export type NodesNodeLxcVmidTemplatePostReturn = null;

/** POST /nodes/{node}/lxc/{vmid}/clone — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidClonePostParams = {
  bwlimit?: string;
  description?: string;
  full?: '0' | '1';
  hostname?: string;
  newid: string;
  pool?: string;
  snapname?: string;
  storage?: string;
  target?: string;
};
/** POST /nodes/{node}/lxc/{vmid}/clone — `data` payload after client unwrap. */
export type NodesNodeLxcVmidClonePostReturn = string;

/** PUT /nodes/{node}/lxc/{vmid}/resize — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidResizePutParams = {
  digest?: string;
  disk:
    | 'rootfs'
    | 'mp0'
    | 'mp1'
    | 'mp2'
    | 'mp3'
    | 'mp4'
    | 'mp5'
    | 'mp6'
    | 'mp7'
    | 'mp8'
    | 'mp9'
    | 'mp10'
    | 'mp11'
    | 'mp12'
    | 'mp13'
    | 'mp14'
    | 'mp15'
    | 'mp16'
    | 'mp17'
    | 'mp18'
    | 'mp19'
    | 'mp20'
    | 'mp21'
    | 'mp22'
    | 'mp23'
    | 'mp24'
    | 'mp25'
    | 'mp26'
    | 'mp27'
    | 'mp28'
    | 'mp29'
    | 'mp30'
    | 'mp31'
    | 'mp32'
    | 'mp33'
    | 'mp34'
    | 'mp35'
    | 'mp36'
    | 'mp37'
    | 'mp38'
    | 'mp39'
    | 'mp40'
    | 'mp41'
    | 'mp42'
    | 'mp43'
    | 'mp44'
    | 'mp45'
    | 'mp46'
    | 'mp47'
    | 'mp48'
    | 'mp49'
    | 'mp50'
    | 'mp51'
    | 'mp52'
    | 'mp53'
    | 'mp54'
    | 'mp55'
    | 'mp56'
    | 'mp57'
    | 'mp58'
    | 'mp59'
    | 'mp60'
    | 'mp61'
    | 'mp62'
    | 'mp63'
    | 'mp64'
    | 'mp65'
    | 'mp66'
    | 'mp67'
    | 'mp68'
    | 'mp69'
    | 'mp70'
    | 'mp71'
    | 'mp72'
    | 'mp73'
    | 'mp74'
    | 'mp75'
    | 'mp76'
    | 'mp77'
    | 'mp78'
    | 'mp79'
    | 'mp80'
    | 'mp81'
    | 'mp82'
    | 'mp83'
    | 'mp84'
    | 'mp85'
    | 'mp86'
    | 'mp87'
    | 'mp88'
    | 'mp89'
    | 'mp90'
    | 'mp91'
    | 'mp92'
    | 'mp93'
    | 'mp94'
    | 'mp95'
    | 'mp96'
    | 'mp97'
    | 'mp98'
    | 'mp99'
    | 'mp100'
    | 'mp101'
    | 'mp102'
    | 'mp103'
    | 'mp104'
    | 'mp105'
    | 'mp106'
    | 'mp107'
    | 'mp108'
    | 'mp109'
    | 'mp110'
    | 'mp111'
    | 'mp112'
    | 'mp113'
    | 'mp114'
    | 'mp115'
    | 'mp116'
    | 'mp117'
    | 'mp118'
    | 'mp119'
    | 'mp120'
    | 'mp121'
    | 'mp122'
    | 'mp123'
    | 'mp124'
    | 'mp125'
    | 'mp126'
    | 'mp127'
    | 'mp128'
    | 'mp129'
    | 'mp130'
    | 'mp131'
    | 'mp132'
    | 'mp133'
    | 'mp134'
    | 'mp135'
    | 'mp136'
    | 'mp137'
    | 'mp138'
    | 'mp139'
    | 'mp140'
    | 'mp141'
    | 'mp142'
    | 'mp143'
    | 'mp144'
    | 'mp145'
    | 'mp146'
    | 'mp147'
    | 'mp148'
    | 'mp149'
    | 'mp150'
    | 'mp151'
    | 'mp152'
    | 'mp153'
    | 'mp154'
    | 'mp155'
    | 'mp156'
    | 'mp157'
    | 'mp158'
    | 'mp159'
    | 'mp160'
    | 'mp161'
    | 'mp162'
    | 'mp163'
    | 'mp164'
    | 'mp165'
    | 'mp166'
    | 'mp167'
    | 'mp168'
    | 'mp169'
    | 'mp170'
    | 'mp171'
    | 'mp172'
    | 'mp173'
    | 'mp174'
    | 'mp175'
    | 'mp176'
    | 'mp177'
    | 'mp178'
    | 'mp179'
    | 'mp180'
    | 'mp181'
    | 'mp182'
    | 'mp183'
    | 'mp184'
    | 'mp185'
    | 'mp186'
    | 'mp187'
    | 'mp188'
    | 'mp189'
    | 'mp190'
    | 'mp191'
    | 'mp192'
    | 'mp193'
    | 'mp194'
    | 'mp195'
    | 'mp196'
    | 'mp197'
    | 'mp198'
    | 'mp199'
    | 'mp200'
    | 'mp201'
    | 'mp202'
    | 'mp203'
    | 'mp204'
    | 'mp205'
    | 'mp206'
    | 'mp207'
    | 'mp208'
    | 'mp209'
    | 'mp210'
    | 'mp211'
    | 'mp212'
    | 'mp213'
    | 'mp214'
    | 'mp215'
    | 'mp216'
    | 'mp217'
    | 'mp218'
    | 'mp219'
    | 'mp220'
    | 'mp221'
    | 'mp222'
    | 'mp223'
    | 'mp224'
    | 'mp225'
    | 'mp226'
    | 'mp227'
    | 'mp228'
    | 'mp229'
    | 'mp230'
    | 'mp231'
    | 'mp232'
    | 'mp233'
    | 'mp234'
    | 'mp235'
    | 'mp236'
    | 'mp237'
    | 'mp238'
    | 'mp239'
    | 'mp240'
    | 'mp241'
    | 'mp242'
    | 'mp243'
    | 'mp244'
    | 'mp245'
    | 'mp246'
    | 'mp247'
    | 'mp248'
    | 'mp249'
    | 'mp250'
    | 'mp251'
    | 'mp252'
    | 'mp253'
    | 'mp254'
    | 'mp255';
  size: string;
};
/** PUT /nodes/{node}/lxc/{vmid}/resize — `data` payload after client unwrap. */
export type NodesNodeLxcVmidResizePutReturn = string;

/** POST /nodes/{node}/lxc/{vmid}/move_volume — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidMove_volumePostParams = {
  bwlimit?: string;
  delete?: '0' | '1';
  digest?: string;
  storage?: string;
  'target-digest'?: string;
  'target-vmid'?: string;
  'target-volume'?:
    | 'rootfs'
    | 'mp0'
    | 'mp1'
    | 'mp2'
    | 'mp3'
    | 'mp4'
    | 'mp5'
    | 'mp6'
    | 'mp7'
    | 'mp8'
    | 'mp9'
    | 'mp10'
    | 'mp11'
    | 'mp12'
    | 'mp13'
    | 'mp14'
    | 'mp15'
    | 'mp16'
    | 'mp17'
    | 'mp18'
    | 'mp19'
    | 'mp20'
    | 'mp21'
    | 'mp22'
    | 'mp23'
    | 'mp24'
    | 'mp25'
    | 'mp26'
    | 'mp27'
    | 'mp28'
    | 'mp29'
    | 'mp30'
    | 'mp31'
    | 'mp32'
    | 'mp33'
    | 'mp34'
    | 'mp35'
    | 'mp36'
    | 'mp37'
    | 'mp38'
    | 'mp39'
    | 'mp40'
    | 'mp41'
    | 'mp42'
    | 'mp43'
    | 'mp44'
    | 'mp45'
    | 'mp46'
    | 'mp47'
    | 'mp48'
    | 'mp49'
    | 'mp50'
    | 'mp51'
    | 'mp52'
    | 'mp53'
    | 'mp54'
    | 'mp55'
    | 'mp56'
    | 'mp57'
    | 'mp58'
    | 'mp59'
    | 'mp60'
    | 'mp61'
    | 'mp62'
    | 'mp63'
    | 'mp64'
    | 'mp65'
    | 'mp66'
    | 'mp67'
    | 'mp68'
    | 'mp69'
    | 'mp70'
    | 'mp71'
    | 'mp72'
    | 'mp73'
    | 'mp74'
    | 'mp75'
    | 'mp76'
    | 'mp77'
    | 'mp78'
    | 'mp79'
    | 'mp80'
    | 'mp81'
    | 'mp82'
    | 'mp83'
    | 'mp84'
    | 'mp85'
    | 'mp86'
    | 'mp87'
    | 'mp88'
    | 'mp89'
    | 'mp90'
    | 'mp91'
    | 'mp92'
    | 'mp93'
    | 'mp94'
    | 'mp95'
    | 'mp96'
    | 'mp97'
    | 'mp98'
    | 'mp99'
    | 'mp100'
    | 'mp101'
    | 'mp102'
    | 'mp103'
    | 'mp104'
    | 'mp105'
    | 'mp106'
    | 'mp107'
    | 'mp108'
    | 'mp109'
    | 'mp110'
    | 'mp111'
    | 'mp112'
    | 'mp113'
    | 'mp114'
    | 'mp115'
    | 'mp116'
    | 'mp117'
    | 'mp118'
    | 'mp119'
    | 'mp120'
    | 'mp121'
    | 'mp122'
    | 'mp123'
    | 'mp124'
    | 'mp125'
    | 'mp126'
    | 'mp127'
    | 'mp128'
    | 'mp129'
    | 'mp130'
    | 'mp131'
    | 'mp132'
    | 'mp133'
    | 'mp134'
    | 'mp135'
    | 'mp136'
    | 'mp137'
    | 'mp138'
    | 'mp139'
    | 'mp140'
    | 'mp141'
    | 'mp142'
    | 'mp143'
    | 'mp144'
    | 'mp145'
    | 'mp146'
    | 'mp147'
    | 'mp148'
    | 'mp149'
    | 'mp150'
    | 'mp151'
    | 'mp152'
    | 'mp153'
    | 'mp154'
    | 'mp155'
    | 'mp156'
    | 'mp157'
    | 'mp158'
    | 'mp159'
    | 'mp160'
    | 'mp161'
    | 'mp162'
    | 'mp163'
    | 'mp164'
    | 'mp165'
    | 'mp166'
    | 'mp167'
    | 'mp168'
    | 'mp169'
    | 'mp170'
    | 'mp171'
    | 'mp172'
    | 'mp173'
    | 'mp174'
    | 'mp175'
    | 'mp176'
    | 'mp177'
    | 'mp178'
    | 'mp179'
    | 'mp180'
    | 'mp181'
    | 'mp182'
    | 'mp183'
    | 'mp184'
    | 'mp185'
    | 'mp186'
    | 'mp187'
    | 'mp188'
    | 'mp189'
    | 'mp190'
    | 'mp191'
    | 'mp192'
    | 'mp193'
    | 'mp194'
    | 'mp195'
    | 'mp196'
    | 'mp197'
    | 'mp198'
    | 'mp199'
    | 'mp200'
    | 'mp201'
    | 'mp202'
    | 'mp203'
    | 'mp204'
    | 'mp205'
    | 'mp206'
    | 'mp207'
    | 'mp208'
    | 'mp209'
    | 'mp210'
    | 'mp211'
    | 'mp212'
    | 'mp213'
    | 'mp214'
    | 'mp215'
    | 'mp216'
    | 'mp217'
    | 'mp218'
    | 'mp219'
    | 'mp220'
    | 'mp221'
    | 'mp222'
    | 'mp223'
    | 'mp224'
    | 'mp225'
    | 'mp226'
    | 'mp227'
    | 'mp228'
    | 'mp229'
    | 'mp230'
    | 'mp231'
    | 'mp232'
    | 'mp233'
    | 'mp234'
    | 'mp235'
    | 'mp236'
    | 'mp237'
    | 'mp238'
    | 'mp239'
    | 'mp240'
    | 'mp241'
    | 'mp242'
    | 'mp243'
    | 'mp244'
    | 'mp245'
    | 'mp246'
    | 'mp247'
    | 'mp248'
    | 'mp249'
    | 'mp250'
    | 'mp251'
    | 'mp252'
    | 'mp253'
    | 'mp254'
    | 'mp255'
    | 'unused0'
    | 'unused1'
    | 'unused2'
    | 'unused3'
    | 'unused4'
    | 'unused5'
    | 'unused6'
    | 'unused7'
    | 'unused8'
    | 'unused9'
    | 'unused10'
    | 'unused11'
    | 'unused12'
    | 'unused13'
    | 'unused14'
    | 'unused15'
    | 'unused16'
    | 'unused17'
    | 'unused18'
    | 'unused19'
    | 'unused20'
    | 'unused21'
    | 'unused22'
    | 'unused23'
    | 'unused24'
    | 'unused25'
    | 'unused26'
    | 'unused27'
    | 'unused28'
    | 'unused29'
    | 'unused30'
    | 'unused31'
    | 'unused32'
    | 'unused33'
    | 'unused34'
    | 'unused35'
    | 'unused36'
    | 'unused37'
    | 'unused38'
    | 'unused39'
    | 'unused40'
    | 'unused41'
    | 'unused42'
    | 'unused43'
    | 'unused44'
    | 'unused45'
    | 'unused46'
    | 'unused47'
    | 'unused48'
    | 'unused49'
    | 'unused50'
    | 'unused51'
    | 'unused52'
    | 'unused53'
    | 'unused54'
    | 'unused55'
    | 'unused56'
    | 'unused57'
    | 'unused58'
    | 'unused59'
    | 'unused60'
    | 'unused61'
    | 'unused62'
    | 'unused63'
    | 'unused64'
    | 'unused65'
    | 'unused66'
    | 'unused67'
    | 'unused68'
    | 'unused69'
    | 'unused70'
    | 'unused71'
    | 'unused72'
    | 'unused73'
    | 'unused74'
    | 'unused75'
    | 'unused76'
    | 'unused77'
    | 'unused78'
    | 'unused79'
    | 'unused80'
    | 'unused81'
    | 'unused82'
    | 'unused83'
    | 'unused84'
    | 'unused85'
    | 'unused86'
    | 'unused87'
    | 'unused88'
    | 'unused89'
    | 'unused90'
    | 'unused91'
    | 'unused92'
    | 'unused93'
    | 'unused94'
    | 'unused95'
    | 'unused96'
    | 'unused97'
    | 'unused98'
    | 'unused99'
    | 'unused100'
    | 'unused101'
    | 'unused102'
    | 'unused103'
    | 'unused104'
    | 'unused105'
    | 'unused106'
    | 'unused107'
    | 'unused108'
    | 'unused109'
    | 'unused110'
    | 'unused111'
    | 'unused112'
    | 'unused113'
    | 'unused114'
    | 'unused115'
    | 'unused116'
    | 'unused117'
    | 'unused118'
    | 'unused119'
    | 'unused120'
    | 'unused121'
    | 'unused122'
    | 'unused123'
    | 'unused124'
    | 'unused125'
    | 'unused126'
    | 'unused127'
    | 'unused128'
    | 'unused129'
    | 'unused130'
    | 'unused131'
    | 'unused132'
    | 'unused133'
    | 'unused134'
    | 'unused135'
    | 'unused136'
    | 'unused137'
    | 'unused138'
    | 'unused139'
    | 'unused140'
    | 'unused141'
    | 'unused142'
    | 'unused143'
    | 'unused144'
    | 'unused145'
    | 'unused146'
    | 'unused147'
    | 'unused148'
    | 'unused149'
    | 'unused150'
    | 'unused151'
    | 'unused152'
    | 'unused153'
    | 'unused154'
    | 'unused155'
    | 'unused156'
    | 'unused157'
    | 'unused158'
    | 'unused159'
    | 'unused160'
    | 'unused161'
    | 'unused162'
    | 'unused163'
    | 'unused164'
    | 'unused165'
    | 'unused166'
    | 'unused167'
    | 'unused168'
    | 'unused169'
    | 'unused170'
    | 'unused171'
    | 'unused172'
    | 'unused173'
    | 'unused174'
    | 'unused175'
    | 'unused176'
    | 'unused177'
    | 'unused178'
    | 'unused179'
    | 'unused180'
    | 'unused181'
    | 'unused182'
    | 'unused183'
    | 'unused184'
    | 'unused185'
    | 'unused186'
    | 'unused187'
    | 'unused188'
    | 'unused189'
    | 'unused190'
    | 'unused191'
    | 'unused192'
    | 'unused193'
    | 'unused194'
    | 'unused195'
    | 'unused196'
    | 'unused197'
    | 'unused198'
    | 'unused199'
    | 'unused200'
    | 'unused201'
    | 'unused202'
    | 'unused203'
    | 'unused204'
    | 'unused205'
    | 'unused206'
    | 'unused207'
    | 'unused208'
    | 'unused209'
    | 'unused210'
    | 'unused211'
    | 'unused212'
    | 'unused213'
    | 'unused214'
    | 'unused215'
    | 'unused216'
    | 'unused217'
    | 'unused218'
    | 'unused219'
    | 'unused220'
    | 'unused221'
    | 'unused222'
    | 'unused223'
    | 'unused224'
    | 'unused225'
    | 'unused226'
    | 'unused227'
    | 'unused228'
    | 'unused229'
    | 'unused230'
    | 'unused231'
    | 'unused232'
    | 'unused233'
    | 'unused234'
    | 'unused235'
    | 'unused236'
    | 'unused237'
    | 'unused238'
    | 'unused239'
    | 'unused240'
    | 'unused241'
    | 'unused242'
    | 'unused243'
    | 'unused244'
    | 'unused245'
    | 'unused246'
    | 'unused247'
    | 'unused248'
    | 'unused249'
    | 'unused250'
    | 'unused251'
    | 'unused252'
    | 'unused253'
    | 'unused254'
    | 'unused255';
  volume:
    | 'rootfs'
    | 'mp0'
    | 'mp1'
    | 'mp2'
    | 'mp3'
    | 'mp4'
    | 'mp5'
    | 'mp6'
    | 'mp7'
    | 'mp8'
    | 'mp9'
    | 'mp10'
    | 'mp11'
    | 'mp12'
    | 'mp13'
    | 'mp14'
    | 'mp15'
    | 'mp16'
    | 'mp17'
    | 'mp18'
    | 'mp19'
    | 'mp20'
    | 'mp21'
    | 'mp22'
    | 'mp23'
    | 'mp24'
    | 'mp25'
    | 'mp26'
    | 'mp27'
    | 'mp28'
    | 'mp29'
    | 'mp30'
    | 'mp31'
    | 'mp32'
    | 'mp33'
    | 'mp34'
    | 'mp35'
    | 'mp36'
    | 'mp37'
    | 'mp38'
    | 'mp39'
    | 'mp40'
    | 'mp41'
    | 'mp42'
    | 'mp43'
    | 'mp44'
    | 'mp45'
    | 'mp46'
    | 'mp47'
    | 'mp48'
    | 'mp49'
    | 'mp50'
    | 'mp51'
    | 'mp52'
    | 'mp53'
    | 'mp54'
    | 'mp55'
    | 'mp56'
    | 'mp57'
    | 'mp58'
    | 'mp59'
    | 'mp60'
    | 'mp61'
    | 'mp62'
    | 'mp63'
    | 'mp64'
    | 'mp65'
    | 'mp66'
    | 'mp67'
    | 'mp68'
    | 'mp69'
    | 'mp70'
    | 'mp71'
    | 'mp72'
    | 'mp73'
    | 'mp74'
    | 'mp75'
    | 'mp76'
    | 'mp77'
    | 'mp78'
    | 'mp79'
    | 'mp80'
    | 'mp81'
    | 'mp82'
    | 'mp83'
    | 'mp84'
    | 'mp85'
    | 'mp86'
    | 'mp87'
    | 'mp88'
    | 'mp89'
    | 'mp90'
    | 'mp91'
    | 'mp92'
    | 'mp93'
    | 'mp94'
    | 'mp95'
    | 'mp96'
    | 'mp97'
    | 'mp98'
    | 'mp99'
    | 'mp100'
    | 'mp101'
    | 'mp102'
    | 'mp103'
    | 'mp104'
    | 'mp105'
    | 'mp106'
    | 'mp107'
    | 'mp108'
    | 'mp109'
    | 'mp110'
    | 'mp111'
    | 'mp112'
    | 'mp113'
    | 'mp114'
    | 'mp115'
    | 'mp116'
    | 'mp117'
    | 'mp118'
    | 'mp119'
    | 'mp120'
    | 'mp121'
    | 'mp122'
    | 'mp123'
    | 'mp124'
    | 'mp125'
    | 'mp126'
    | 'mp127'
    | 'mp128'
    | 'mp129'
    | 'mp130'
    | 'mp131'
    | 'mp132'
    | 'mp133'
    | 'mp134'
    | 'mp135'
    | 'mp136'
    | 'mp137'
    | 'mp138'
    | 'mp139'
    | 'mp140'
    | 'mp141'
    | 'mp142'
    | 'mp143'
    | 'mp144'
    | 'mp145'
    | 'mp146'
    | 'mp147'
    | 'mp148'
    | 'mp149'
    | 'mp150'
    | 'mp151'
    | 'mp152'
    | 'mp153'
    | 'mp154'
    | 'mp155'
    | 'mp156'
    | 'mp157'
    | 'mp158'
    | 'mp159'
    | 'mp160'
    | 'mp161'
    | 'mp162'
    | 'mp163'
    | 'mp164'
    | 'mp165'
    | 'mp166'
    | 'mp167'
    | 'mp168'
    | 'mp169'
    | 'mp170'
    | 'mp171'
    | 'mp172'
    | 'mp173'
    | 'mp174'
    | 'mp175'
    | 'mp176'
    | 'mp177'
    | 'mp178'
    | 'mp179'
    | 'mp180'
    | 'mp181'
    | 'mp182'
    | 'mp183'
    | 'mp184'
    | 'mp185'
    | 'mp186'
    | 'mp187'
    | 'mp188'
    | 'mp189'
    | 'mp190'
    | 'mp191'
    | 'mp192'
    | 'mp193'
    | 'mp194'
    | 'mp195'
    | 'mp196'
    | 'mp197'
    | 'mp198'
    | 'mp199'
    | 'mp200'
    | 'mp201'
    | 'mp202'
    | 'mp203'
    | 'mp204'
    | 'mp205'
    | 'mp206'
    | 'mp207'
    | 'mp208'
    | 'mp209'
    | 'mp210'
    | 'mp211'
    | 'mp212'
    | 'mp213'
    | 'mp214'
    | 'mp215'
    | 'mp216'
    | 'mp217'
    | 'mp218'
    | 'mp219'
    | 'mp220'
    | 'mp221'
    | 'mp222'
    | 'mp223'
    | 'mp224'
    | 'mp225'
    | 'mp226'
    | 'mp227'
    | 'mp228'
    | 'mp229'
    | 'mp230'
    | 'mp231'
    | 'mp232'
    | 'mp233'
    | 'mp234'
    | 'mp235'
    | 'mp236'
    | 'mp237'
    | 'mp238'
    | 'mp239'
    | 'mp240'
    | 'mp241'
    | 'mp242'
    | 'mp243'
    | 'mp244'
    | 'mp245'
    | 'mp246'
    | 'mp247'
    | 'mp248'
    | 'mp249'
    | 'mp250'
    | 'mp251'
    | 'mp252'
    | 'mp253'
    | 'mp254'
    | 'mp255'
    | 'unused0'
    | 'unused1'
    | 'unused2'
    | 'unused3'
    | 'unused4'
    | 'unused5'
    | 'unused6'
    | 'unused7'
    | 'unused8'
    | 'unused9'
    | 'unused10'
    | 'unused11'
    | 'unused12'
    | 'unused13'
    | 'unused14'
    | 'unused15'
    | 'unused16'
    | 'unused17'
    | 'unused18'
    | 'unused19'
    | 'unused20'
    | 'unused21'
    | 'unused22'
    | 'unused23'
    | 'unused24'
    | 'unused25'
    | 'unused26'
    | 'unused27'
    | 'unused28'
    | 'unused29'
    | 'unused30'
    | 'unused31'
    | 'unused32'
    | 'unused33'
    | 'unused34'
    | 'unused35'
    | 'unused36'
    | 'unused37'
    | 'unused38'
    | 'unused39'
    | 'unused40'
    | 'unused41'
    | 'unused42'
    | 'unused43'
    | 'unused44'
    | 'unused45'
    | 'unused46'
    | 'unused47'
    | 'unused48'
    | 'unused49'
    | 'unused50'
    | 'unused51'
    | 'unused52'
    | 'unused53'
    | 'unused54'
    | 'unused55'
    | 'unused56'
    | 'unused57'
    | 'unused58'
    | 'unused59'
    | 'unused60'
    | 'unused61'
    | 'unused62'
    | 'unused63'
    | 'unused64'
    | 'unused65'
    | 'unused66'
    | 'unused67'
    | 'unused68'
    | 'unused69'
    | 'unused70'
    | 'unused71'
    | 'unused72'
    | 'unused73'
    | 'unused74'
    | 'unused75'
    | 'unused76'
    | 'unused77'
    | 'unused78'
    | 'unused79'
    | 'unused80'
    | 'unused81'
    | 'unused82'
    | 'unused83'
    | 'unused84'
    | 'unused85'
    | 'unused86'
    | 'unused87'
    | 'unused88'
    | 'unused89'
    | 'unused90'
    | 'unused91'
    | 'unused92'
    | 'unused93'
    | 'unused94'
    | 'unused95'
    | 'unused96'
    | 'unused97'
    | 'unused98'
    | 'unused99'
    | 'unused100'
    | 'unused101'
    | 'unused102'
    | 'unused103'
    | 'unused104'
    | 'unused105'
    | 'unused106'
    | 'unused107'
    | 'unused108'
    | 'unused109'
    | 'unused110'
    | 'unused111'
    | 'unused112'
    | 'unused113'
    | 'unused114'
    | 'unused115'
    | 'unused116'
    | 'unused117'
    | 'unused118'
    | 'unused119'
    | 'unused120'
    | 'unused121'
    | 'unused122'
    | 'unused123'
    | 'unused124'
    | 'unused125'
    | 'unused126'
    | 'unused127'
    | 'unused128'
    | 'unused129'
    | 'unused130'
    | 'unused131'
    | 'unused132'
    | 'unused133'
    | 'unused134'
    | 'unused135'
    | 'unused136'
    | 'unused137'
    | 'unused138'
    | 'unused139'
    | 'unused140'
    | 'unused141'
    | 'unused142'
    | 'unused143'
    | 'unused144'
    | 'unused145'
    | 'unused146'
    | 'unused147'
    | 'unused148'
    | 'unused149'
    | 'unused150'
    | 'unused151'
    | 'unused152'
    | 'unused153'
    | 'unused154'
    | 'unused155'
    | 'unused156'
    | 'unused157'
    | 'unused158'
    | 'unused159'
    | 'unused160'
    | 'unused161'
    | 'unused162'
    | 'unused163'
    | 'unused164'
    | 'unused165'
    | 'unused166'
    | 'unused167'
    | 'unused168'
    | 'unused169'
    | 'unused170'
    | 'unused171'
    | 'unused172'
    | 'unused173'
    | 'unused174'
    | 'unused175'
    | 'unused176'
    | 'unused177'
    | 'unused178'
    | 'unused179'
    | 'unused180'
    | 'unused181'
    | 'unused182'
    | 'unused183'
    | 'unused184'
    | 'unused185'
    | 'unused186'
    | 'unused187'
    | 'unused188'
    | 'unused189'
    | 'unused190'
    | 'unused191'
    | 'unused192'
    | 'unused193'
    | 'unused194'
    | 'unused195'
    | 'unused196'
    | 'unused197'
    | 'unused198'
    | 'unused199'
    | 'unused200'
    | 'unused201'
    | 'unused202'
    | 'unused203'
    | 'unused204'
    | 'unused205'
    | 'unused206'
    | 'unused207'
    | 'unused208'
    | 'unused209'
    | 'unused210'
    | 'unused211'
    | 'unused212'
    | 'unused213'
    | 'unused214'
    | 'unused215'
    | 'unused216'
    | 'unused217'
    | 'unused218'
    | 'unused219'
    | 'unused220'
    | 'unused221'
    | 'unused222'
    | 'unused223'
    | 'unused224'
    | 'unused225'
    | 'unused226'
    | 'unused227'
    | 'unused228'
    | 'unused229'
    | 'unused230'
    | 'unused231'
    | 'unused232'
    | 'unused233'
    | 'unused234'
    | 'unused235'
    | 'unused236'
    | 'unused237'
    | 'unused238'
    | 'unused239'
    | 'unused240'
    | 'unused241'
    | 'unused242'
    | 'unused243'
    | 'unused244'
    | 'unused245'
    | 'unused246'
    | 'unused247'
    | 'unused248'
    | 'unused249'
    | 'unused250'
    | 'unused251'
    | 'unused252'
    | 'unused253'
    | 'unused254'
    | 'unused255';
};
/** POST /nodes/{node}/lxc/{vmid}/move_volume — `data` payload after client unwrap. */
export type NodesNodeLxcVmidMove_volumePostReturn = string;

/** GET /nodes/{node}/lxc/{vmid}/pending — `data` payload after client unwrap. */
export type NodesNodeLxcVmidPendingGetReturn = readonly ({
  delete?: number;
  key: string;
  pending?: string;
  value?: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/lxc/{vmid}/interfaces — `data` payload after client unwrap. */
export type NodesNodeLxcVmidInterfacesGetReturn = readonly ({
  'hardware-address': string;
  hwaddr: string;
  inet?: string;
  inet6?: string;
  'ip-addresses': readonly ({
    'ip-address'?: string;
    'ip-address-type'?: string;
    prefix?: number;
  } & Record<string, unknown>)[];
  name: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/lxc/{vmid}/mtunnel — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidMtunnelPostParams = { bridges?: string; storages?: string };
/** POST /nodes/{node}/lxc/{vmid}/mtunnel — `data` payload after client unwrap. */
export type NodesNodeLxcVmidMtunnelPostReturn = { socket: string; ticket: string; upid: string };

/** GET /nodes/{node}/lxc/{vmid}/mtunnelwebsocket — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidMtunnelwebsocketGetParams = { socket: string; ticket: string };
/** GET /nodes/{node}/lxc/{vmid}/mtunnelwebsocket — `data` payload after client unwrap. */
export type NodesNodeLxcVmidMtunnelwebsocketGetReturn = { port?: string; socket?: string } & Record<
  string,
  unknown
>;

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

/** GET /nodes/{node}/ceph/osd — `data` payload after client unwrap. */
export type NodesNodeCephOsdGetReturn = { flags?: string; root: unknown } & Record<string, unknown>;

/** POST /nodes/{node}/ceph/osd — form/query parameters (path segments omitted). */
export type NodesNodeCephOsdPostParams = {
  'crush-device-class'?: string;
  db_dev?: string;
  db_dev_size?: string;
  dev: string;
  encrypted?: '0' | '1';
  'osds-per-device'?: string;
  wal_dev?: string;
  wal_dev_size?: string;
};
/** POST /nodes/{node}/ceph/osd — `data` payload after client unwrap. */
export type NodesNodeCephOsdPostReturn = string;

/** GET /nodes/{node}/ceph/osd/{osdid} — `data` payload after client unwrap. */
export type NodesNodeCephOsdOsdidGetReturn = readonly Record<string, unknown>[];

/** DELETE /nodes/{node}/ceph/osd/{osdid} — form/query parameters (path segments omitted). */
export type NodesNodeCephOsdOsdidDeleteParams = { cleanup?: '0' | '1' };
/** DELETE /nodes/{node}/ceph/osd/{osdid} — `data` payload after client unwrap. */
export type NodesNodeCephOsdOsdidDeleteReturn = string;

/** GET /nodes/{node}/ceph/osd/{osdid}/metadata — `data` payload after client unwrap. */
export type NodesNodeCephOsdOsdidMetadataGetReturn = {
  devices: readonly ({
    dev_node: string;
    device: 'block' | 'db' | 'wal';
    physical_device: string;
    size: number;
    support_discard: boolean | 0 | 1;
    type: string;
  } & Record<string, unknown>)[];
  osd: {
    back_addr: string;
    encrypted: boolean | 0 | 1;
    front_addr: string;
    hb_back_addr: string;
    hb_front_addr: string;
    hostname: string;
    id: number;
    mem_usage: number;
    osd_data: string;
    osd_objectstore: string;
    pid?: number;
    version: string;
  } & Record<string, unknown>;
} & Record<string, unknown>;

/** GET /nodes/{node}/ceph/osd/{osdid}/lv-info — form/query parameters (path segments omitted). */
export type NodesNodeCephOsdOsdidLvInfoGetParams = { type?: 'block' | 'db' | 'wal' };
/** GET /nodes/{node}/ceph/osd/{osdid}/lv-info — `data` payload after client unwrap. */
export type NodesNodeCephOsdOsdidLvInfoGetReturn = {
  creation_time: string;
  lv_name: string;
  lv_path: string;
  lv_size: number;
  lv_uuid: string;
  vg_name: string;
} & Record<string, unknown>;

/** POST /nodes/{node}/ceph/osd/{osdid}/in — `data` payload after client unwrap. */
export type NodesNodeCephOsdOsdidInPostReturn = null;

/** POST /nodes/{node}/ceph/osd/{osdid}/out — `data` payload after client unwrap. */
export type NodesNodeCephOsdOsdidOutPostReturn = null;

/** POST /nodes/{node}/ceph/osd/{osdid}/scrub — form/query parameters (path segments omitted). */
export type NodesNodeCephOsdOsdidScrubPostParams = { deep?: '0' | '1' };
/** POST /nodes/{node}/ceph/osd/{osdid}/scrub — `data` payload after client unwrap. */
export type NodesNodeCephOsdOsdidScrubPostReturn = null;

/** GET /nodes/{node}/ceph/mds — `data` payload after client unwrap. */
export type NodesNodeCephMdsGetReturn = readonly ({
  addr?: string;
  ceph_version?: string;
  ceph_version_short?: string;
  direxists?: boolean | 0 | 1;
  fs_name?: string;
  host?: string;
  name: string;
  rank?: number;
  service?: boolean | 0 | 1;
  standby_replay?: boolean | 0 | 1;
  state: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/ceph/mds/{name} — form/query parameters (path segments omitted). */
export type NodesNodeCephMdsNamePostParams = { hotstandby?: '0' | '1' };
/** POST /nodes/{node}/ceph/mds/{name} — `data` payload after client unwrap. */
export type NodesNodeCephMdsNamePostReturn = string;

/** DELETE /nodes/{node}/ceph/mds/{name} — `data` payload after client unwrap. */
export type NodesNodeCephMdsNameDeleteReturn = string;

/** GET /nodes/{node}/ceph/mgr — `data` payload after client unwrap. */
export type NodesNodeCephMgrGetReturn = readonly ({
  addr?: string;
  ceph_version?: string;
  ceph_version_short?: string;
  direxists?: boolean | 0 | 1;
  host?: string;
  name: string;
  service?: boolean | 0 | 1;
  state: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/ceph/mgr/{id} — `data` payload after client unwrap. */
export type NodesNodeCephMgrIdPostReturn = string;

/** DELETE /nodes/{node}/ceph/mgr/{id} — `data` payload after client unwrap. */
export type NodesNodeCephMgrIdDeleteReturn = string;

/** GET /nodes/{node}/ceph/mon — `data` payload after client unwrap. */
export type NodesNodeCephMonGetReturn = readonly ({
  addr?: string;
  ceph_version?: string;
  ceph_version_short?: string;
  direxists?: boolean | 0 | 1;
  host?: string;
  name: string;
  quorum?: boolean | 0 | 1;
  rank?: number;
  service?: boolean | 0 | 1;
  state?: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/ceph/mon/{monid} — form/query parameters (path segments omitted). */
export type NodesNodeCephMonMonidPostParams = { 'mon-address'?: string };
/** POST /nodes/{node}/ceph/mon/{monid} — `data` payload after client unwrap. */
export type NodesNodeCephMonMonidPostReturn = string;

/** DELETE /nodes/{node}/ceph/mon/{monid} — `data` payload after client unwrap. */
export type NodesNodeCephMonMonidDeleteReturn = string;

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
export type NodesNodeCephFsNamePostParams = { 'add-storage'?: '0' | '1'; pg_num?: string };
/** POST /nodes/{node}/ceph/fs/{name} — `data` payload after client unwrap. */
export type NodesNodeCephFsNamePostReturn = string;

/** DELETE /nodes/{node}/ceph/fs/{name} — form/query parameters (path segments omitted). */
export type NodesNodeCephFsNameDeleteParams = {
  'remove-pools'?: '0' | '1';
  'remove-storages'?: '0' | '1';
};
/** DELETE /nodes/{node}/ceph/fs/{name} — `data` payload after client unwrap. */
export type NodesNodeCephFsNameDeleteReturn = string;

/** GET /nodes/{node}/ceph/pool — `data` payload after client unwrap. */
export type NodesNodeCephPoolGetReturn = readonly ({
  application_metadata?: unknown;
  autoscale_status?: unknown;
  bytes_used?: number;
  crush_rule: number;
  crush_rule_name?: string;
  min_size: number;
  percent_used?: number;
  pg_autoscale_mode?: string;
  pg_num: number;
  pg_num_final?: number;
  pg_num_min?: number;
  pool: number;
  pool_name: string;
  size: number;
  target_size?: number;
  target_size_ratio?: number;
  type: 'replicated' | 'erasure' | 'unknown';
} & Record<string, unknown>)[];

/** POST /nodes/{node}/ceph/pool — form/query parameters (path segments omitted). */
export type NodesNodeCephPoolPostParams = {
  add_storages?: '0' | '1';
  application?: 'rbd' | 'cephfs' | 'rgw';
  crush_rule?: string;
  'erasure-coding'?: string;
  min_size?: string;
  name: string;
  pg_autoscale_mode?: 'on' | 'off' | 'warn';
  pg_num?: string;
  pg_num_min?: string;
  size?: string;
  target_size?: string;
  target_size_ratio?: string;
};
/** POST /nodes/{node}/ceph/pool — `data` payload after client unwrap. */
export type NodesNodeCephPoolPostReturn = string;

/** GET /nodes/{node}/ceph/pool/{name} — `data` payload after client unwrap. */
export type NodesNodeCephPoolNameGetReturn = readonly Record<string, unknown>[];

/** PUT /nodes/{node}/ceph/pool/{name} — form/query parameters (path segments omitted). */
export type NodesNodeCephPoolNamePutParams = {
  application?: 'rbd' | 'cephfs' | 'rgw';
  crush_rule?: string;
  min_size?: string;
  pg_autoscale_mode?: 'on' | 'off' | 'warn';
  pg_num?: string;
  pg_num_min?: string;
  size?: string;
  target_size?: string;
  target_size_ratio?: string;
};
/** PUT /nodes/{node}/ceph/pool/{name} — `data` payload after client unwrap. */
export type NodesNodeCephPoolNamePutReturn = string;

/** DELETE /nodes/{node}/ceph/pool/{name} — form/query parameters (path segments omitted). */
export type NodesNodeCephPoolNameDeleteParams = {
  force?: '0' | '1';
  remove_ecprofile?: '0' | '1';
  remove_storages?: '0' | '1';
};
/** DELETE /nodes/{node}/ceph/pool/{name} — `data` payload after client unwrap. */
export type NodesNodeCephPoolNameDeleteReturn = string;

/** GET /nodes/{node}/ceph/pool/{name}/status — form/query parameters (path segments omitted). */
export type NodesNodeCephPoolNameStatusGetParams = { verbose?: '0' | '1' };
/** GET /nodes/{node}/ceph/pool/{name}/status — `data` payload after client unwrap. */
export type NodesNodeCephPoolNameStatusGetReturn = {
  application?: 'rbd' | 'cephfs' | 'rgw';
  application_list?: readonly string[];
  autoscale_status?: unknown;
  crush_rule?: string;
  fast_read: boolean | 0 | 1;
  hashpspool: boolean | 0 | 1;
  id: number;
  min_size?: number;
  name: string;
  'nodeep-scrub': boolean | 0 | 1;
  nodelete: boolean | 0 | 1;
  nopgchange: boolean | 0 | 1;
  noscrub: boolean | 0 | 1;
  nosizechange: boolean | 0 | 1;
  pg_autoscale_mode?: 'on' | 'off' | 'warn';
  pg_num?: number;
  pg_num_min?: number;
  pgp_num: number;
  size?: number;
  statistics?: unknown;
  target_size?: string;
  target_size_ratio?: number;
  use_gmt_hitset: boolean | 0 | 1;
  write_fadvise_dontneed: boolean | 0 | 1;
} & Record<string, unknown>;

/** GET /nodes/{node}/ceph/releases — `data` payload after client unwrap. */
export type NodesNodeCephReleasesGetReturn = readonly ({
  available: boolean | 0 | 1;
  'is-default': boolean | 0 | 1;
  release: string;
  unsupported: boolean | 0 | 1;
  version: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/ceph/init — form/query parameters (path segments omitted). */
export type NodesNodeCephInitPostParams = {
  'cluster-network'?: string;
  disable_cephx?: '0' | '1';
  min_size?: string;
  network?: string;
  pg_bits?: string;
  size?: string;
};
/** POST /nodes/{node}/ceph/init — `data` payload after client unwrap. */
export type NodesNodeCephInitPostReturn = null;

/** POST /nodes/{node}/ceph/stop — form/query parameters (path segments omitted). */
export type NodesNodeCephStopPostParams = { service?: string };
/** POST /nodes/{node}/ceph/stop — `data` payload after client unwrap. */
export type NodesNodeCephStopPostReturn = string;

/** POST /nodes/{node}/ceph/start — form/query parameters (path segments omitted). */
export type NodesNodeCephStartPostParams = { service?: string };
/** POST /nodes/{node}/ceph/start — `data` payload after client unwrap. */
export type NodesNodeCephStartPostReturn = string;

/** POST /nodes/{node}/ceph/restart — form/query parameters (path segments omitted). */
export type NodesNodeCephRestartPostParams = { service?: string };
/** POST /nodes/{node}/ceph/restart — `data` payload after client unwrap. */
export type NodesNodeCephRestartPostReturn = string;

/** POST /nodes/{node}/ceph/restart-bulk — form/query parameters (path segments omitted). */
export type NodesNodeCephRestartBulkPostParams = {
  'dry-run'?: '0' | '1';
  force?: '0' | '1';
  'only-outdated'?: '0' | '1';
  resume?: '0' | '1';
  'service-type': 'osd';
  'set-noout'?: '0' | '1';
  timeout?: string;
};
/** POST /nodes/{node}/ceph/restart-bulk — `data` payload after client unwrap. */
export type NodesNodeCephRestartBulkPostReturn = string;

/** GET /nodes/{node}/ceph/status — `data` payload after client unwrap. */
export type NodesNodeCephStatusGetReturn = unknown;

/** GET /nodes/{node}/ceph/crush — `data` payload after client unwrap. */
export type NodesNodeCephCrushGetReturn = string;

/** GET /nodes/{node}/ceph/log — form/query parameters (path segments omitted). */
export type NodesNodeCephLogGetParams = { limit?: string; start?: string };
/** GET /nodes/{node}/ceph/log — `data` payload after client unwrap. */
export type NodesNodeCephLogGetReturn = readonly ({ n: number; t: string } & Record<
  string,
  unknown
>)[];

/** GET /nodes/{node}/ceph/rules — `data` payload after client unwrap. */
export type NodesNodeCephRulesGetReturn = readonly ({ name: string } & Record<string, unknown>)[];

/** GET /nodes/{node}/ceph/cmd-safety — form/query parameters (path segments omitted). */
export type NodesNodeCephCmdSafetyGetParams = {
  action: 'stop' | 'destroy';
  id: string;
  service: 'osd' | 'mon' | 'mds';
};
/** GET /nodes/{node}/ceph/cmd-safety — `data` payload after client unwrap. */
export type NodesNodeCephCmdSafetyGetReturn = { safe: boolean | 0 | 1; status?: string };

/** GET /nodes/{node}/network — form/query parameters (path segments omitted). */
export type NodesNodeNetworkGetParams = {
  type?:
    | 'bridge'
    | 'bond'
    | 'eth'
    | 'alias'
    | 'vlan'
    | 'fabric'
    | 'OVSBridge'
    | 'OVSBond'
    | 'OVSPort'
    | 'OVSIntPort'
    | 'vnet'
    | 'any_bridge'
    | 'any_local_bridge'
    | 'include_sdn';
};
/** GET /nodes/{node}/network — `data` payload after client unwrap. */
export type NodesNodeNetworkGetReturn = readonly ({
  active?: boolean | 0 | 1;
  address?: string;
  address6?: string;
  autostart?: boolean | 0 | 1;
  'bond-primary'?: string;
  bond_mode?:
    | 'balance-rr'
    | 'active-backup'
    | 'balance-xor'
    | 'broadcast'
    | '802.3ad'
    | 'balance-tlb'
    | 'balance-alb'
    | 'balance-slb'
    | 'lacp-balance-slb'
    | 'lacp-balance-tcp';
  bond_xmit_hash_policy?: 'layer2' | 'layer2+3' | 'layer3+4';
  'bridge-access'?: number;
  'bridge-arp-nd-suppress'?: boolean | 0 | 1;
  'bridge-learning'?: boolean | 0 | 1;
  'bridge-multicast-flood'?: boolean | 0 | 1;
  'bridge-unicast-flood'?: boolean | 0 | 1;
  bridge_ports?: string;
  bridge_vids?: string;
  bridge_vlan_aware?: boolean | 0 | 1;
  cidr?: string;
  cidr6?: string;
  comments?: string;
  comments6?: string;
  exists?: boolean | 0 | 1;
  families?: readonly ('inet' | 'inet6')[];
  gateway?: string;
  gateway6?: string;
  iface: string;
  'link-type'?: string;
  method?: 'loopback' | 'dhcp' | 'manual' | 'static' | 'auto';
  method6?: 'loopback' | 'dhcp' | 'manual' | 'static' | 'auto';
  mtu?: number;
  netmask?: string;
  netmask6?: number;
  options?: readonly string[];
  options6?: readonly string[];
  ovs_bonds?: string;
  ovs_bridge?: string;
  ovs_options?: string;
  ovs_ports?: string;
  ovs_tag?: number;
  priority?: number;
  slaves?: string;
  type:
    | 'bridge'
    | 'bond'
    | 'eth'
    | 'alias'
    | 'vlan'
    | 'fabric'
    | 'OVSBridge'
    | 'OVSBond'
    | 'OVSPort'
    | 'OVSIntPort'
    | 'vnet'
    | 'unknown';
  'uplink-id'?: string;
  'vlan-id'?: number;
  'vlan-protocol'?: '802.1ad' | '802.1q';
  'vlan-raw-device'?: string;
  'vxlan-id'?: number;
  'vxlan-local-tunnelip'?: string;
  'vxlan-physdev'?: string;
  'vxlan-svcnodeip'?: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/network — form/query parameters (path segments omitted). */
export type NodesNodeNetworkPostParams = {
  address?: string;
  address6?: string;
  autostart?: '0' | '1';
  'bond-primary'?: string;
  bond_mode?:
    | 'balance-rr'
    | 'active-backup'
    | 'balance-xor'
    | 'broadcast'
    | '802.3ad'
    | 'balance-tlb'
    | 'balance-alb'
    | 'balance-slb'
    | 'lacp-balance-slb'
    | 'lacp-balance-tcp';
  bond_xmit_hash_policy?: 'layer2' | 'layer2+3' | 'layer3+4';
  bridge_ports?: string;
  bridge_vids?: string;
  bridge_vlan_aware?: '0' | '1';
  cidr?: string;
  cidr6?: string;
  comments?: string;
  comments6?: string;
  gateway?: string;
  gateway6?: string;
  iface: string;
  mtu?: string;
  netmask?: string;
  netmask6?: string;
  ovs_bonds?: string;
  ovs_bridge?: string;
  ovs_options?: string;
  ovs_ports?: string;
  ovs_tag?: string;
  slaves?: string;
  type:
    | 'bridge'
    | 'bond'
    | 'eth'
    | 'alias'
    | 'vlan'
    | 'fabric'
    | 'OVSBridge'
    | 'OVSBond'
    | 'OVSPort'
    | 'OVSIntPort'
    | 'vnet'
    | 'unknown';
  'vlan-id'?: string;
  'vlan-raw-device'?: string;
};
/** POST /nodes/{node}/network — `data` payload after client unwrap. */
export type NodesNodeNetworkPostReturn = null;

/** PUT /nodes/{node}/network — form/query parameters (path segments omitted). */
export type NodesNodeNetworkPutParams = { 'regenerate-frr'?: '0' | '1' };
/** PUT /nodes/{node}/network — `data` payload after client unwrap. */
export type NodesNodeNetworkPutReturn = string;

/** DELETE /nodes/{node}/network — `data` payload after client unwrap. */
export type NodesNodeNetworkDeleteReturn = null;

/** GET /nodes/{node}/network/{iface} — `data` payload after client unwrap. */
export type NodesNodeNetworkIfaceGetReturn = { method: string; type: string } & Record<
  string,
  unknown
>;

/** PUT /nodes/{node}/network/{iface} — form/query parameters (path segments omitted). */
export type NodesNodeNetworkIfacePutParams = {
  address?: string;
  address6?: string;
  autostart?: '0' | '1';
  'bond-primary'?: string;
  bond_mode?:
    | 'balance-rr'
    | 'active-backup'
    | 'balance-xor'
    | 'broadcast'
    | '802.3ad'
    | 'balance-tlb'
    | 'balance-alb'
    | 'balance-slb'
    | 'lacp-balance-slb'
    | 'lacp-balance-tcp';
  bond_xmit_hash_policy?: 'layer2' | 'layer2+3' | 'layer3+4';
  bridge_ports?: string;
  bridge_vids?: string;
  bridge_vlan_aware?: '0' | '1';
  cidr?: string;
  cidr6?: string;
  comments?: string;
  comments6?: string;
  delete?: string;
  gateway?: string;
  gateway6?: string;
  mtu?: string;
  netmask?: string;
  netmask6?: string;
  ovs_bonds?: string;
  ovs_bridge?: string;
  ovs_options?: string;
  ovs_ports?: string;
  ovs_tag?: string;
  slaves?: string;
  type:
    | 'bridge'
    | 'bond'
    | 'eth'
    | 'alias'
    | 'vlan'
    | 'fabric'
    | 'OVSBridge'
    | 'OVSBond'
    | 'OVSPort'
    | 'OVSIntPort'
    | 'vnet'
    | 'unknown';
  'vlan-id'?: string;
  'vlan-raw-device'?: string;
};
/** PUT /nodes/{node}/network/{iface} — `data` payload after client unwrap. */
export type NodesNodeNetworkIfacePutReturn = null;

/** DELETE /nodes/{node}/network/{iface} — `data` payload after client unwrap. */
export type NodesNodeNetworkIfaceDeleteReturn = null;

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

/** GET /nodes/{node}/disks/zfs — `data` payload after client unwrap. */
export type NodesNodeDisksZfsGetReturn = readonly ({
  alloc: number;
  dedup: number;
  frag: number;
  free: number;
  health: string;
  name: string;
  size: number;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/disks/zfs — form/query parameters (path segments omitted). */
export type NodesNodeDisksZfsPostParams = {
  add_storage?: '0' | '1';
  ashift?: string;
  compression?: 'on' | 'off' | 'gzip' | 'lz4' | 'lzjb' | 'zle' | 'zstd';
  devices: string;
  'draid-config'?: string;
  name: string;
  raidlevel:
    | 'single'
    | 'mirror'
    | 'raid10'
    | 'raidz'
    | 'raidz2'
    | 'raidz3'
    | 'draid'
    | 'draid2'
    | 'draid3';
};
/** POST /nodes/{node}/disks/zfs — `data` payload after client unwrap. */
export type NodesNodeDisksZfsPostReturn = string;

/** GET /nodes/{node}/disks/zfs/{name} — `data` payload after client unwrap. */
export type NodesNodeDisksZfsNameGetReturn = {
  action?: string;
  children: readonly ({
    cksum?: number;
    msg: string;
    name: string;
    read?: number;
    state?: string;
    write?: number;
  } & Record<string, unknown>)[];
  errors: string;
  name: string;
  scan?: string;
  state: string;
  status?: string;
} & Record<string, unknown>;

/** DELETE /nodes/{node}/disks/zfs/{name} — form/query parameters (path segments omitted). */
export type NodesNodeDisksZfsNameDeleteParams = {
  'cleanup-config'?: '0' | '1';
  'cleanup-disks'?: '0' | '1';
};
/** DELETE /nodes/{node}/disks/zfs/{name} — `data` payload after client unwrap. */
export type NodesNodeDisksZfsNameDeleteReturn = string;

/** GET /storage — form/query parameters (path segments omitted). */
export type StorageGetParams = {
  type?:
    | 'btrfs'
    | 'cephfs'
    | 'cifs'
    | 'dir'
    | 'esxi'
    | 'iscsi'
    | 'iscsidirect'
    | 'lvm'
    | 'lvmthin'
    | 'nfs'
    | 'pbs'
    | 'rbd'
    | 'zfs'
    | 'zfspool';
};
/** GET /storage — `data` payload after client unwrap. */
export type StorageGetReturn = readonly ({ storage: string } & Record<string, unknown>)[];

/** POST /storage — form/query parameters (path segments omitted). */
export type StoragePostParams = {
  authsupported?: string;
  base?: string;
  blocksize?: string;
  bwlimit?: string;
  comstar_hg?: string;
  comstar_tg?: string;
  content?: string;
  'content-dirs'?: string;
  'create-base-path'?: '0' | '1';
  'create-subdirs'?: '0' | '1';
  'data-pool'?: string;
  datastore?: string;
  disable?: '0' | '1';
  domain?: string;
  'encryption-key'?: string;
  export?: string;
  fingerprint?: string;
  format?: 'raw' | 'qcow2' | 'subvol' | 'vmdk';
  'fs-name'?: string;
  fuse?: '0' | '1';
  is_mountpoint?: string;
  iscsiprovider?: string;
  keyring?: string;
  krbd?: '0' | '1';
  lio_tpg?: string;
  'master-pubkey'?: string;
  'max-protected-backups'?: string;
  mkdir?: '0' | '1';
  monhost?: string;
  mountpoint?: string;
  namespace?: string;
  nocow?: '0' | '1';
  nodes?: string;
  nowritecache?: '0' | '1';
  options?: string;
  password?: string;
  path?: string;
  pool?: string;
  port?: string;
  portal?: string;
  preallocation?: 'off' | 'metadata' | 'falloc' | 'full';
  'prune-backups'?: string;
  saferemove?: '0' | '1';
  'saferemove-stepsize'?: '1' | '2' | '4' | '8' | '16' | '32';
  saferemove_throughput?: string;
  server?: string;
  share?: string;
  shared?: '0' | '1';
  'skip-cert-verification'?: '0' | '1';
  smbversion?: 'default' | '2.0' | '2.1' | '3' | '3.0' | '3.11';
  'snapshot-as-volume-chain'?: '0' | '1';
  sparse?: '0' | '1';
  storage: string;
  subdir?: string;
  tagged_only?: '0' | '1';
  target?: string;
  thinpool?: string;
  type:
    | 'btrfs'
    | 'cephfs'
    | 'cifs'
    | 'dir'
    | 'esxi'
    | 'iscsi'
    | 'iscsidirect'
    | 'lvm'
    | 'lvmthin'
    | 'nfs'
    | 'pbs'
    | 'rbd'
    | 'zfs'
    | 'zfspool';
  username?: string;
  vgname?: string;
  'zfs-base-path'?: string;
};
/** POST /storage — `data` payload after client unwrap. */
export type StoragePostReturn = {
  config?: { 'encryption-key'?: string } & Record<string, unknown>;
  storage: string;
  type:
    | 'btrfs'
    | 'cephfs'
    | 'cifs'
    | 'dir'
    | 'esxi'
    | 'iscsi'
    | 'iscsidirect'
    | 'lvm'
    | 'lvmthin'
    | 'nfs'
    | 'pbs'
    | 'rbd'
    | 'zfs'
    | 'zfspool';
} & Record<string, unknown>;

/** GET /storage/{storage} — `data` payload after client unwrap. */
export type StorageStorageGetReturn = unknown;

/** PUT /storage/{storage} — form/query parameters (path segments omitted). */
export type StorageStoragePutParams = {
  blocksize?: string;
  bwlimit?: string;
  comstar_hg?: string;
  comstar_tg?: string;
  content?: string;
  'content-dirs'?: string;
  'create-base-path'?: '0' | '1';
  'create-subdirs'?: '0' | '1';
  'data-pool'?: string;
  delete?: string;
  digest?: string;
  disable?: '0' | '1';
  domain?: string;
  'encryption-key'?: string;
  fingerprint?: string;
  format?: 'raw' | 'qcow2' | 'subvol' | 'vmdk';
  'fs-name'?: string;
  fuse?: '0' | '1';
  is_mountpoint?: string;
  keyring?: string;
  krbd?: '0' | '1';
  lio_tpg?: string;
  'master-pubkey'?: string;
  'max-protected-backups'?: string;
  mkdir?: '0' | '1';
  monhost?: string;
  mountpoint?: string;
  namespace?: string;
  nocow?: '0' | '1';
  nodes?: string;
  nowritecache?: '0' | '1';
  options?: string;
  password?: string;
  pool?: string;
  port?: string;
  preallocation?: 'off' | 'metadata' | 'falloc' | 'full';
  'prune-backups'?: string;
  saferemove?: '0' | '1';
  'saferemove-stepsize'?: '1' | '2' | '4' | '8' | '16' | '32';
  saferemove_throughput?: string;
  server?: string;
  shared?: '0' | '1';
  'skip-cert-verification'?: '0' | '1';
  smbversion?: 'default' | '2.0' | '2.1' | '3' | '3.0' | '3.11';
  'snapshot-as-volume-chain'?: '0' | '1';
  sparse?: '0' | '1';
  subdir?: string;
  tagged_only?: '0' | '1';
  username?: string;
  'zfs-base-path'?: string;
};
/** PUT /storage/{storage} — `data` payload after client unwrap. */
export type StorageStoragePutReturn = {
  config?: { 'encryption-key'?: string } & Record<string, unknown>;
  storage: string;
  type:
    | 'btrfs'
    | 'cephfs'
    | 'cifs'
    | 'dir'
    | 'esxi'
    | 'iscsi'
    | 'iscsidirect'
    | 'lvm'
    | 'lvmthin'
    | 'nfs'
    | 'pbs'
    | 'rbd'
    | 'zfs'
    | 'zfspool';
} & Record<string, unknown>;

/** DELETE /storage/{storage} — `data` payload after client unwrap. */
export type StorageStorageDeleteReturn = null;

/** GET /access/users — form/query parameters (path segments omitted). */
export type AccessUsersGetParams = { enabled?: '0' | '1'; full?: '0' | '1' };
/** GET /access/users — `data` payload after client unwrap. */
export type AccessUsersGetReturn = readonly ({
  comment?: string;
  email?: string;
  enable?: boolean | 0 | 1;
  expire?: number;
  firstname?: string;
  groups?: string;
  keys?: string;
  lastname?: string;
  'realm-type'?: string;
  'tfa-locked-until'?: number;
  tokens?: readonly ({
    comment?: string;
    expire?: number;
    privsep?: boolean | 0 | 1;
    tokenid: string;
  } & Record<string, unknown>)[];
  'totp-locked'?: boolean | 0 | 1;
  userid: string;
} & Record<string, unknown>)[];

/** POST /access/users — form/query parameters (path segments omitted). */
export type AccessUsersPostParams = {
  comment?: string;
  email?: string;
  enable?: '0' | '1';
  expire?: string;
  firstname?: string;
  groups?: string;
  keys?: string;
  lastname?: string;
  password?: string;
  userid: string;
};
/** POST /access/users — `data` payload after client unwrap. */
export type AccessUsersPostReturn = null;

/** GET /access/users/{userid} — `data` payload after client unwrap. */
export type AccessUsersUseridGetReturn = {
  comment?: string;
  email?: string;
  enable?: boolean | 0 | 1;
  expire?: number;
  firstname?: string;
  groups?: readonly string[];
  keys?: string;
  lastname?: string;
  tokens?: unknown;
};

/** PUT /access/users/{userid} — form/query parameters (path segments omitted). */
export type AccessUsersUseridPutParams = {
  append?: '0' | '1';
  comment?: string;
  email?: string;
  enable?: '0' | '1';
  expire?: string;
  firstname?: string;
  groups?: string;
  keys?: string;
  lastname?: string;
};
/** PUT /access/users/{userid} — `data` payload after client unwrap. */
export type AccessUsersUseridPutReturn = null;

/** DELETE /access/users/{userid} — `data` payload after client unwrap. */
export type AccessUsersUseridDeleteReturn = null;

/** GET /access/users/{userid}/tfa — form/query parameters (path segments omitted). */
export type AccessUsersUseridTfaGetParams = { multiple?: '0' | '1' };
/** GET /access/users/{userid}/tfa — `data` payload after client unwrap. */
export type AccessUsersUseridTfaGetReturn = {
  realm?: 'oath' | 'yubico';
  types?: readonly ('totp' | 'u2f' | 'yubico' | 'webauthn' | 'recovedry')[];
  user?: 'oath' | 'u2f';
};

/** PUT /access/users/{userid}/unlock-tfa — `data` payload after client unwrap. */
export type AccessUsersUseridUnlockTfaPutReturn = boolean | 0 | 1;

/** GET /access/users/{userid}/token — `data` payload after client unwrap. */
export type AccessUsersUseridTokenGetReturn = readonly ({
  comment?: string;
  expire?: number;
  privsep?: boolean | 0 | 1;
  tokenid: string;
} & Record<string, unknown>)[];

/** GET /access/users/{userid}/token/{tokenid} — `data` payload after client unwrap. */
export type AccessUsersUseridTokenTokenidGetReturn = {
  comment?: string;
  expire?: number;
  privsep?: boolean | 0 | 1;
} & Record<string, unknown>;

/** POST /access/users/{userid}/token/{tokenid} — form/query parameters (path segments omitted). */
export type AccessUsersUseridTokenTokenidPostParams = {
  comment?: string;
  expire?: string;
  privsep?: '0' | '1';
};
/** POST /access/users/{userid}/token/{tokenid} — `data` payload after client unwrap. */
export type AccessUsersUseridTokenTokenidPostReturn = {
  'full-tokenid': string;
  info: { comment?: string; expire?: number; privsep?: boolean | 0 | 1 } & Record<string, unknown>;
  value: string;
};

/** PUT /access/users/{userid}/token/{tokenid} — form/query parameters (path segments omitted). */
export type AccessUsersUseridTokenTokenidPutParams = {
  comment?: string;
  delete?: string;
  expire?: string;
  privsep?: '0' | '1';
  regenerate?: '0' | '1';
};
/** PUT /access/users/{userid}/token/{tokenid} — `data` payload after client unwrap. */
export type AccessUsersUseridTokenTokenidPutReturn = {
  comment?: string;
  expire?: number;
  'full-tokenid'?: string;
  privsep?: boolean | 0 | 1;
  value?: string;
} & Record<string, unknown>;

/** DELETE /access/users/{userid}/token/{tokenid} — `data` payload after client unwrap. */
export type AccessUsersUseridTokenTokenidDeleteReturn = null;

/** GET /access/groups — `data` payload after client unwrap. */
export type AccessGroupsGetReturn = readonly ({
  comment?: string;
  groupid: string;
  users?: string;
} & Record<string, unknown>)[];

/** POST /access/groups — form/query parameters (path segments omitted). */
export type AccessGroupsPostParams = { comment?: string; groupid: string };
/** POST /access/groups — `data` payload after client unwrap. */
export type AccessGroupsPostReturn = null;

/** GET /access/groups/{groupid} — `data` payload after client unwrap. */
export type AccessGroupsGroupidGetReturn = { comment?: string; members: readonly string[] };

/** PUT /access/groups/{groupid} — form/query parameters (path segments omitted). */
export type AccessGroupsGroupidPutParams = { comment?: string };
/** PUT /access/groups/{groupid} — `data` payload after client unwrap. */
export type AccessGroupsGroupidPutReturn = null;

/** DELETE /access/groups/{groupid} — `data` payload after client unwrap. */
export type AccessGroupsGroupidDeleteReturn = null;

/** GET /access/roles — `data` payload after client unwrap. */
export type AccessRolesGetReturn = readonly ({
  privs?: string;
  roleid: string;
  special?: boolean | 0 | 1;
} & Record<string, unknown>)[];

/** POST /access/roles — form/query parameters (path segments omitted). */
export type AccessRolesPostParams = { privs?: string; roleid: string };
/** POST /access/roles — `data` payload after client unwrap. */
export type AccessRolesPostReturn = null;

/** GET /access/roles/{roleid} — `data` payload after client unwrap. */
export type AccessRolesRoleidGetReturn = {
  'Datastore.Allocate'?: boolean | 0 | 1;
  'Datastore.AllocateSpace'?: boolean | 0 | 1;
  'Datastore.AllocateTemplate'?: boolean | 0 | 1;
  'Datastore.Audit'?: boolean | 0 | 1;
  'Group.Allocate'?: boolean | 0 | 1;
  'Mapping.Audit'?: boolean | 0 | 1;
  'Mapping.Modify'?: boolean | 0 | 1;
  'Mapping.Use'?: boolean | 0 | 1;
  'Permissions.Modify'?: boolean | 0 | 1;
  'Pool.Allocate'?: boolean | 0 | 1;
  'Pool.Audit'?: boolean | 0 | 1;
  'Realm.Allocate'?: boolean | 0 | 1;
  'Realm.AllocateUser'?: boolean | 0 | 1;
  'SDN.Allocate'?: boolean | 0 | 1;
  'SDN.Audit'?: boolean | 0 | 1;
  'SDN.Use'?: boolean | 0 | 1;
  'Sys.AccessNetwork'?: boolean | 0 | 1;
  'Sys.Audit'?: boolean | 0 | 1;
  'Sys.Console'?: boolean | 0 | 1;
  'Sys.Incoming'?: boolean | 0 | 1;
  'Sys.Modify'?: boolean | 0 | 1;
  'Sys.PowerMgmt'?: boolean | 0 | 1;
  'Sys.Syslog'?: boolean | 0 | 1;
  'User.Modify'?: boolean | 0 | 1;
  'VM.Allocate'?: boolean | 0 | 1;
  'VM.Audit'?: boolean | 0 | 1;
  'VM.Backup'?: boolean | 0 | 1;
  'VM.Clone'?: boolean | 0 | 1;
  'VM.Config.CDROM'?: boolean | 0 | 1;
  'VM.Config.CPU'?: boolean | 0 | 1;
  'VM.Config.Cloudinit'?: boolean | 0 | 1;
  'VM.Config.Disk'?: boolean | 0 | 1;
  'VM.Config.HWType'?: boolean | 0 | 1;
  'VM.Config.Memory'?: boolean | 0 | 1;
  'VM.Config.Network'?: boolean | 0 | 1;
  'VM.Config.Options'?: boolean | 0 | 1;
  'VM.Console'?: boolean | 0 | 1;
  'VM.GuestAgent.Audit'?: boolean | 0 | 1;
  'VM.GuestAgent.FileRead'?: boolean | 0 | 1;
  'VM.GuestAgent.FileSystemMgmt'?: boolean | 0 | 1;
  'VM.GuestAgent.FileWrite'?: boolean | 0 | 1;
  'VM.GuestAgent.Unrestricted'?: boolean | 0 | 1;
  'VM.Migrate'?: boolean | 0 | 1;
  'VM.PowerMgmt'?: boolean | 0 | 1;
  'VM.Replicate'?: boolean | 0 | 1;
  'VM.Snapshot'?: boolean | 0 | 1;
  'VM.Snapshot.Rollback'?: boolean | 0 | 1;
};

/** PUT /access/roles/{roleid} — form/query parameters (path segments omitted). */
export type AccessRolesRoleidPutParams = { append?: '0' | '1'; privs?: string };
/** PUT /access/roles/{roleid} — `data` payload after client unwrap. */
export type AccessRolesRoleidPutReturn = null;

/** DELETE /access/roles/{roleid} — `data` payload after client unwrap. */
export type AccessRolesRoleidDeleteReturn = null;

/** GET /access/acl — `data` payload after client unwrap. */
export type AccessAclGetReturn = readonly {
  path: string;
  propagate?: boolean | 0 | 1;
  roleid: string;
  type: 'user' | 'group' | 'token';
  ugid: string;
}[];

/** PUT /access/acl — form/query parameters (path segments omitted). */
export type AccessAclPutParams = {
  delete?: '0' | '1';
  groups?: string;
  path: string;
  propagate?: '0' | '1';
  roles: string;
  tokens?: string;
  users?: string;
};
/** PUT /access/acl — `data` payload after client unwrap. */
export type AccessAclPutReturn = null;

/** GET /pools — form/query parameters (path segments omitted). */
export type PoolsGetParams = { poolid?: string; type?: 'qemu' | 'lxc' | 'storage' };
/** GET /pools — `data` payload after client unwrap. */
export type PoolsGetReturn = readonly ({
  comment?: string;
  members?: readonly ({
    id: string;
    node: string;
    storage?: string;
    type: 'qemu' | 'lxc' | 'openvz' | 'storage';
    vmid?: number;
  } & Record<string, unknown>)[];
  poolid: string;
} & Record<string, unknown>)[];

/** POST /pools — form/query parameters (path segments omitted). */
export type PoolsPostParams = { comment?: string; poolid: string };
/** POST /pools — `data` payload after client unwrap. */
export type PoolsPostReturn = null;

/** PUT /pools — form/query parameters (path segments omitted). */
export type PoolsPutParams = {
  'allow-move'?: '0' | '1';
  comment?: string;
  delete?: '0' | '1';
  poolid: string;
  storage?: string;
  vms?: string;
};
/** PUT /pools — `data` payload after client unwrap. */
export type PoolsPutReturn = null;

/** DELETE /pools — form/query parameters (path segments omitted). */
export type PoolsDeleteParams = { poolid: string };
/** DELETE /pools — `data` payload after client unwrap. */
export type PoolsDeleteReturn = null;

/** GET /pools/{poolid} — form/query parameters (path segments omitted). */
export type PoolsPoolidGetParams = { type?: 'qemu' | 'lxc' | 'storage' };
/** GET /pools/{poolid} — `data` payload after client unwrap. */
export type PoolsPoolidGetReturn = {
  comment?: string;
  members: readonly ({
    id: string;
    node: string;
    storage?: string;
    type: 'qemu' | 'lxc' | 'openvz' | 'storage';
    vmid?: number;
  } & Record<string, unknown>)[];
};

/** PUT /pools/{poolid} — form/query parameters (path segments omitted). */
export type PoolsPoolidPutParams = {
  'allow-move'?: '0' | '1';
  comment?: string;
  delete?: '0' | '1';
  storage?: string;
  vms?: string;
};
/** PUT /pools/{poolid} — `data` payload after client unwrap. */
export type PoolsPoolidPutReturn = null;

/** DELETE /pools/{poolid} — `data` payload after client unwrap. */
export type PoolsPoolidDeleteReturn = null;
