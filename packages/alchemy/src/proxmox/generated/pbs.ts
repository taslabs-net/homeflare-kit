/**
 * Generated PBS API types — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/generate.ts
 * Source: the cluster's own `apidoc.js` (pve-docs), extracted outside this repo.
 */

/** GET /config/datastore — `data` payload after client unwrap. */
export type ConfigDatastoreGetReturn = readonly {
  backend?: string;
  'backing-device'?: string;
  comment?: string;
  'counter-reset-schedule'?: string;
  'gc-on-unmount'?: boolean | 0 | 1;
  'gc-schedule'?: string;
  'keep-daily'?: number;
  'keep-hourly'?: number;
  'keep-last'?: number;
  'keep-monthly'?: number;
  'keep-weekly'?: number;
  'keep-yearly'?: number;
  'maintenance-mode'?: string;
  name: string;
  'notification-mode'?: 'legacy-sendmail' | 'notification-system';
  'notification-thresholds'?: string;
  notify?: string;
  'notify-user'?: string;
  path: string;
  'prune-schedule'?: string;
  tuning?: string;
  'verify-new'?: boolean | 0 | 1;
}[];

/** POST /config/datastore — form/query parameters (path segments omitted). */
export type ConfigDatastorePostParams = {
  backend?: string;
  'backing-device'?: string;
  comment?: string;
  'counter-reset-schedule'?: string;
  'gc-on-unmount'?: '0' | '1';
  'gc-schedule'?: string;
  'keep-daily'?: string;
  'keep-hourly'?: string;
  'keep-last'?: string;
  'keep-monthly'?: string;
  'keep-weekly'?: string;
  'keep-yearly'?: string;
  'maintenance-mode'?: string;
  name: string;
  'notification-mode'?: 'legacy-sendmail' | 'notification-system';
  'notification-thresholds'?: string;
  notify?: string;
  'notify-user'?: string;
  'overwrite-in-use'?: '0' | '1';
  path: string;
  'prune-schedule'?: string;
  'reuse-datastore'?: '0' | '1';
  tuning?: string;
  'verify-new'?: '0' | '1';
};
/** POST /config/datastore — `data` payload after client unwrap. */
export type ConfigDatastorePostReturn = null;

/** GET /config/datastore/{name} — `data` payload after client unwrap. */
export type ConfigDatastoreNameGetReturn = {
  backend?: string;
  'backing-device'?: string;
  comment?: string;
  'counter-reset-schedule'?: string;
  'gc-on-unmount'?: boolean | 0 | 1;
  'gc-schedule'?: string;
  'keep-daily'?: number;
  'keep-hourly'?: number;
  'keep-last'?: number;
  'keep-monthly'?: number;
  'keep-weekly'?: number;
  'keep-yearly'?: number;
  'maintenance-mode'?: string;
  name: string;
  'notification-mode'?: 'legacy-sendmail' | 'notification-system';
  'notification-thresholds'?: string;
  notify?: string;
  'notify-user'?: string;
  path: string;
  'prune-schedule'?: string;
  tuning?: string;
  'verify-new'?: boolean | 0 | 1;
};

/** PUT /config/datastore/{name} — form/query parameters (path segments omitted). */
export type ConfigDatastoreNamePutParams = {
  comment?: string;
  'counter-reset-schedule'?: string;
  delete?: readonly (
    | 'comment'
    | 'gc-schedule'
    | 'gc-on-unmount'
    | 'prune-schedule'
    | 'keep-last'
    | 'keep-hourly'
    | 'keep-daily'
    | 'keep-weekly'
    | 'keep-monthly'
    | 'keep-yearly'
    | 'verify-new'
    | 'notify-user'
    | 'notify'
    | 'notification-mode'
    | 'tuning'
    | 'maintenance-mode'
    | 'notification-thresholds'
    | 'counter-reset-schedule'
  )[];
  digest?: string;
  'gc-on-unmount'?: '0' | '1';
  'gc-schedule'?: string;
  'keep-daily'?: string;
  'keep-hourly'?: string;
  'keep-last'?: string;
  'keep-monthly'?: string;
  'keep-weekly'?: string;
  'keep-yearly'?: string;
  'maintenance-mode'?: string;
  'notification-mode'?: 'legacy-sendmail' | 'notification-system';
  'notification-thresholds'?: string;
  notify?: string;
  'notify-user'?: string;
  'prune-schedule'?: string;
  tuning?: string;
  'verify-new'?: '0' | '1';
};
/** PUT /config/datastore/{name} — `data` payload after client unwrap. */
export type ConfigDatastoreNamePutReturn = null;

/** DELETE /config/datastore/{name} — form/query parameters (path segments omitted). */
export type ConfigDatastoreNameDeleteParams = {
  'destroy-data'?: '0' | '1';
  digest?: string;
  'keep-job-configs'?: '0' | '1';
};
/** DELETE /config/datastore/{name} — `data` payload after client unwrap. */
export type ConfigDatastoreNameDeleteReturn = string;

/** GET /config/notifications/endpoints — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsGetReturn = null;

/** GET /config/notifications/endpoints/gotify — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsGotifyGetReturn = readonly {
  comment?: string;
  disable?: boolean | 0 | 1;
  filter?: string;
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  server: string;
}[];

/** POST /config/notifications/endpoints/gotify — form/query parameters (path segments omitted). */
export type ConfigNotificationsEndpointsGotifyPostParams = {
  comment?: string;
  disable?: '0' | '1';
  filter?: string;
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  server: string;
  token: string;
};
/** POST /config/notifications/endpoints/gotify — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsGotifyPostReturn = null;

/** GET /config/notifications/endpoints/gotify/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsGotifyNameGetReturn = {
  comment?: string;
  disable?: boolean | 0 | 1;
  filter?: string;
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  server: string;
};

/** PUT /config/notifications/endpoints/gotify/{name} — form/query parameters (path segments omitted). */
export type ConfigNotificationsEndpointsGotifyNamePutParams = {
  comment?: string;
  delete?: readonly ('comment' | 'disable')[];
  digest?: string;
  disable?: '0' | '1';
  server?: string;
  token?: string;
};
/** PUT /config/notifications/endpoints/gotify/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsGotifyNamePutReturn = null;

/** DELETE /config/notifications/endpoints/gotify/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsGotifyNameDeleteReturn = null;

/** GET /config/notifications/endpoints/sendmail — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSendmailGetReturn = readonly {
  author?: string;
  comment?: string;
  disable?: boolean | 0 | 1;
  filter?: string;
  'from-address'?: string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
}[];

/** POST /config/notifications/endpoints/sendmail — form/query parameters (path segments omitted). */
export type ConfigNotificationsEndpointsSendmailPostParams = {
  author?: string;
  comment?: string;
  disable?: '0' | '1';
  filter?: string;
  'from-address'?: string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
};
/** POST /config/notifications/endpoints/sendmail — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSendmailPostReturn = null;

/** GET /config/notifications/endpoints/sendmail/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSendmailNameGetReturn = {
  author?: string;
  comment?: string;
  disable?: boolean | 0 | 1;
  filter?: string;
  'from-address'?: string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
};

/** PUT /config/notifications/endpoints/sendmail/{name} — form/query parameters (path segments omitted). */
export type ConfigNotificationsEndpointsSendmailNamePutParams = {
  author?: string;
  comment?: string;
  delete?: readonly (
    | 'author'
    | 'comment'
    | 'disable'
    | 'from-address'
    | 'mailto'
    | 'mailto-user'
  )[];
  digest?: string;
  disable?: '0' | '1';
  'from-address'?: string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
};
/** PUT /config/notifications/endpoints/sendmail/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSendmailNamePutReturn = null;

/** DELETE /config/notifications/endpoints/sendmail/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSendmailNameDeleteReturn = null;

/** GET /config/notifications/endpoints/smtp — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSmtpGetReturn = readonly {
  author?: string;
  comment?: string;
  disable?: boolean | 0 | 1;
  'from-address': string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  mode?: 'insecure' | 'starttls' | 'tls';
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  port?: number;
  server: string;
  username?: string;
}[];

/** POST /config/notifications/endpoints/smtp — form/query parameters (path segments omitted). */
export type ConfigNotificationsEndpointsSmtpPostParams = {
  author?: string;
  comment?: string;
  disable?: '0' | '1';
  'from-address': string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  mode?: 'insecure' | 'starttls' | 'tls';
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  password?: string;
  port?: string;
  server: string;
  username?: string;
};
/** POST /config/notifications/endpoints/smtp — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSmtpPostReturn = null;

/** GET /config/notifications/endpoints/smtp/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSmtpNameGetReturn = {
  author?: string;
  comment?: string;
  disable?: boolean | 0 | 1;
  'from-address': string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  mode?: 'insecure' | 'starttls' | 'tls';
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  port?: number;
  server: string;
  username?: string;
};

/** PUT /config/notifications/endpoints/smtp/{name} — form/query parameters (path segments omitted). */
export type ConfigNotificationsEndpointsSmtpNamePutParams = {
  author?: string;
  comment?: string;
  delete?: readonly (
    | 'author'
    | 'comment'
    | 'disable'
    | 'mailto'
    | 'mailto-user'
    | 'password'
    | 'port'
    | 'username'
  )[];
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
/** PUT /config/notifications/endpoints/smtp/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSmtpNamePutReturn = null;

/** DELETE /config/notifications/endpoints/smtp/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSmtpNameDeleteReturn = null;

/** GET /config/notifications/endpoints/webhook — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsWebhookGetReturn = readonly {
  body?: string;
  comment?: string;
  disable?: boolean | 0 | 1;
  header?: readonly string[];
  method: 'post' | 'put' | 'get';
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  secret?: readonly string[];
  url: string;
}[];

/** POST /config/notifications/endpoints/webhook — form/query parameters (path segments omitted). */
export type ConfigNotificationsEndpointsWebhookPostParams = {
  body?: string;
  comment?: string;
  disable?: '0' | '1';
  header?: readonly string[];
  method: 'post' | 'put' | 'get';
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  secret?: readonly string[];
  url: string;
};
/** POST /config/notifications/endpoints/webhook — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsWebhookPostReturn = null;

/** GET /config/notifications/endpoints/webhook/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsWebhookNameGetReturn = {
  body?: string;
  comment?: string;
  disable?: boolean | 0 | 1;
  header?: readonly string[];
  method: 'post' | 'put' | 'get';
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  secret?: readonly string[];
  url: string;
};

/** PUT /config/notifications/endpoints/webhook/{name} — form/query parameters (path segments omitted). */
export type ConfigNotificationsEndpointsWebhookNamePutParams = {
  body?: string;
  comment?: string;
  delete?: readonly ('comment' | 'disable' | 'header' | 'body' | 'secret')[];
  digest?: string;
  disable?: '0' | '1';
  header?: readonly string[];
  method?: 'post' | 'put' | 'get';
  secret?: readonly string[];
  url?: string;
};
/** PUT /config/notifications/endpoints/webhook/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsWebhookNamePutReturn = null;

/** DELETE /config/notifications/endpoints/webhook/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsWebhookNameDeleteReturn = null;

/** GET /config/notifications/matchers — `data` payload after client unwrap. */
export type ConfigNotificationsMatchersGetReturn = readonly {
  comment?: string;
  disable?: boolean | 0 | 1;
  'invert-match'?: boolean | 0 | 1;
  'match-calendar'?: readonly string[];
  'match-field'?: readonly string[];
  'match-severity'?: readonly string[];
  mode?: 'all' | 'any';
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  target?: readonly string[];
}[];

/** POST /config/notifications/matchers — form/query parameters (path segments omitted). */
export type ConfigNotificationsMatchersPostParams = {
  comment?: string;
  disable?: '0' | '1';
  'invert-match'?: '0' | '1';
  'match-calendar'?: readonly string[];
  'match-field'?: readonly string[];
  'match-severity'?: readonly string[];
  mode?: 'all' | 'any';
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  target?: readonly string[];
};
/** POST /config/notifications/matchers — `data` payload after client unwrap. */
export type ConfigNotificationsMatchersPostReturn = null;

/** GET /config/notifications/matchers/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsMatchersNameGetReturn = {
  comment?: string;
  disable?: boolean | 0 | 1;
  'invert-match'?: boolean | 0 | 1;
  'match-calendar'?: readonly string[];
  'match-field'?: readonly string[];
  'match-severity'?: readonly string[];
  mode?: 'all' | 'any';
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  target?: readonly string[];
};

/** PUT /config/notifications/matchers/{name} — form/query parameters (path segments omitted). */
export type ConfigNotificationsMatchersNamePutParams = {
  comment?: string;
  delete?: readonly (
    | 'comment'
    | 'disable'
    | 'invert-match'
    | 'match-calendar'
    | 'match-field'
    | 'match-severity'
    | 'mode'
    | 'target'
  )[];
  digest?: string;
  disable?: '0' | '1';
  'invert-match'?: '0' | '1';
  'match-calendar'?: readonly string[];
  'match-field'?: readonly string[];
  'match-severity'?: readonly string[];
  mode?: 'all' | 'any';
  target?: readonly string[];
};
/** PUT /config/notifications/matchers/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsMatchersNamePutReturn = null;

/** DELETE /config/notifications/matchers/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsMatchersNameDeleteReturn = null;

/** GET /config/prune — `data` payload after client unwrap. */
export type ConfigPruneGetReturn = readonly {
  comment?: string;
  disable?: boolean | 0 | 1;
  id: string;
  'keep-daily'?: number;
  'keep-hourly'?: number;
  'keep-last'?: number;
  'keep-monthly'?: number;
  'keep-weekly'?: number;
  'keep-yearly'?: number;
  'max-depth'?: number;
  ns?: string;
  schedule: string;
  store: string;
}[];

/** POST /config/prune — form/query parameters (path segments omitted). */
export type ConfigPrunePostParams = {
  comment?: string;
  disable?: '0' | '1';
  id: string;
  'keep-daily'?: string;
  'keep-hourly'?: string;
  'keep-last'?: string;
  'keep-monthly'?: string;
  'keep-weekly'?: string;
  'keep-yearly'?: string;
  'max-depth'?: string;
  ns?: string;
  schedule: string;
  store: string;
};
/** POST /config/prune — `data` payload after client unwrap. */
export type ConfigPrunePostReturn = null;

/** GET /config/prune/{id} — `data` payload after client unwrap. */
export type ConfigPruneIdGetReturn = {
  comment?: string;
  disable?: boolean | 0 | 1;
  id: string;
  'keep-daily'?: number;
  'keep-hourly'?: number;
  'keep-last'?: number;
  'keep-monthly'?: number;
  'keep-weekly'?: number;
  'keep-yearly'?: number;
  'max-depth'?: number;
  ns?: string;
  schedule: string;
  store: string;
};

/** PUT /config/prune/{id} — form/query parameters (path segments omitted). */
export type ConfigPruneIdPutParams = {
  comment?: string;
  delete?: readonly (
    | 'comment'
    | 'disable'
    | 'ns'
    | 'max-depth'
    | 'keep-last'
    | 'keep-hourly'
    | 'keep-daily'
    | 'keep-weekly'
    | 'keep-monthly'
    | 'keep-yearly'
  )[];
  digest?: string;
  disable?: '0' | '1';
  'keep-daily'?: string;
  'keep-hourly'?: string;
  'keep-last'?: string;
  'keep-monthly'?: string;
  'keep-weekly'?: string;
  'keep-yearly'?: string;
  'max-depth'?: string;
  ns?: string;
  schedule?: string;
  store?: string;
};
/** PUT /config/prune/{id} — `data` payload after client unwrap. */
export type ConfigPruneIdPutReturn = null;

/** DELETE /config/prune/{id} — form/query parameters (path segments omitted). */
export type ConfigPruneIdDeleteParams = { digest?: string };
/** DELETE /config/prune/{id} — `data` payload after client unwrap. */
export type ConfigPruneIdDeleteReturn = null;

/** GET /config/sync — form/query parameters (path segments omitted). */
export type ConfigSyncGetParams = { 'sync-direction'?: 'all' | 'push' | 'pull' };
/** GET /config/sync — `data` payload after client unwrap. */
export type ConfigSyncGetReturn = readonly {
  'active-encryption-key'?: string;
  'associated-key'?: readonly string[];
  'burst-in'?: string;
  'burst-out'?: string;
  comment?: string;
  'encrypted-only'?: boolean | 0 | 1;
  'group-filter'?: readonly string[];
  id: string;
  'max-depth'?: number;
  ns?: string;
  owner?: string;
  'rate-in'?: string;
  'rate-out'?: string;
  remote?: string;
  'remote-ns'?: string;
  'remote-store': string;
  'remove-vanished'?: boolean | 0 | 1;
  'resync-corrupt'?: boolean | 0 | 1;
  'run-on-mount'?: boolean | 0 | 1;
  schedule?: string;
  store: string;
  'sync-direction'?: 'pull' | 'push';
  'transfer-last'?: number;
  'unmount-on-done'?: boolean | 0 | 1;
  'verified-only'?: boolean | 0 | 1;
  'worker-threads'?: number;
}[];

/** POST /config/sync — form/query parameters (path segments omitted). */
export type ConfigSyncPostParams = {
  'active-encryption-key'?: string;
  'associated-key'?: readonly string[];
  'burst-in'?: string;
  'burst-out'?: string;
  comment?: string;
  'encrypted-only'?: '0' | '1';
  'group-filter'?: readonly string[];
  id: string;
  'max-depth'?: string;
  ns?: string;
  owner?: string;
  'rate-in'?: string;
  'rate-out'?: string;
  remote?: string;
  'remote-ns'?: string;
  'remote-store': string;
  'remove-vanished'?: '0' | '1';
  'resync-corrupt'?: '0' | '1';
  'run-on-mount'?: '0' | '1';
  schedule?: string;
  store: string;
  'sync-direction'?: 'pull' | 'push';
  'transfer-last'?: string;
  'unmount-on-done'?: '0' | '1';
  'verified-only'?: '0' | '1';
  'worker-threads'?: string;
};
/** POST /config/sync — `data` payload after client unwrap. */
export type ConfigSyncPostReturn = null;

/** GET /config/sync/{id} — `data` payload after client unwrap. */
export type ConfigSyncIdGetReturn = {
  'active-encryption-key'?: string;
  'associated-key'?: readonly string[];
  'burst-in'?: string;
  'burst-out'?: string;
  comment?: string;
  'encrypted-only'?: boolean | 0 | 1;
  'group-filter'?: readonly string[];
  id: string;
  'max-depth'?: number;
  ns?: string;
  owner?: string;
  'rate-in'?: string;
  'rate-out'?: string;
  remote?: string;
  'remote-ns'?: string;
  'remote-store': string;
  'remove-vanished'?: boolean | 0 | 1;
  'resync-corrupt'?: boolean | 0 | 1;
  'run-on-mount'?: boolean | 0 | 1;
  schedule?: string;
  store: string;
  'sync-direction'?: 'pull' | 'push';
  'transfer-last'?: number;
  'unmount-on-done'?: boolean | 0 | 1;
  'verified-only'?: boolean | 0 | 1;
  'worker-threads'?: number;
};

/** PUT /config/sync/{id} — form/query parameters (path segments omitted). */
export type ConfigSyncIdPutParams = {
  'active-encryption-key'?: string;
  'associated-key'?: readonly string[];
  'burst-in'?: string;
  'burst-out'?: string;
  comment?: string;
  delete?: readonly (
    | 'remote'
    | 'owner'
    | 'comment'
    | 'schedule'
    | 'remove-vanished'
    | 'group-filter'
    | 'rate-in'
    | 'burst-in'
    | 'rate-out'
    | 'burst-out'
    | 'ns'
    | 'remote-ns'
    | 'max-depth'
    | 'transfer-last'
    | 'encrypted-only'
    | 'verified-only'
    | 'run-on-mount'
    | 'unmount-on-done'
    | 'sync-direction'
    | 'worker-threads'
    | 'active-encryption-key'
    | 'associated-key'
  )[];
  digest?: string;
  'encrypted-only'?: '0' | '1';
  'group-filter'?: readonly string[];
  'max-depth'?: string;
  ns?: string;
  owner?: string;
  'rate-in'?: string;
  'rate-out'?: string;
  remote?: string;
  'remote-ns'?: string;
  'remote-store'?: string;
  'remove-vanished'?: '0' | '1';
  'resync-corrupt'?: '0' | '1';
  'run-on-mount'?: '0' | '1';
  schedule?: string;
  store?: string;
  'sync-direction'?: 'pull' | 'push';
  'transfer-last'?: string;
  'unmount-on-done'?: '0' | '1';
  'verified-only'?: '0' | '1';
  'worker-threads'?: string;
};
/** PUT /config/sync/{id} — `data` payload after client unwrap. */
export type ConfigSyncIdPutReturn = null;

/** DELETE /config/sync/{id} — form/query parameters (path segments omitted). */
export type ConfigSyncIdDeleteParams = { digest?: string };
/** DELETE /config/sync/{id} — `data` payload after client unwrap. */
export type ConfigSyncIdDeleteReturn = null;

/** GET /config/verify — `data` payload after client unwrap. */
export type ConfigVerifyGetReturn = readonly {
  comment?: string;
  id: string;
  'ignore-verified'?: boolean | 0 | 1;
  'max-depth'?: number;
  ns?: string;
  'outdated-after'?: number;
  'read-threads'?: number;
  schedule?: string;
  store: string;
  'verify-threads'?: number;
}[];

/** POST /config/verify — form/query parameters (path segments omitted). */
export type ConfigVerifyPostParams = {
  comment?: string;
  id: string;
  'ignore-verified'?: '0' | '1';
  'max-depth'?: string;
  ns?: string;
  'outdated-after'?: string;
  'read-threads'?: string;
  schedule?: string;
  store: string;
  'verify-threads'?: string;
};
/** POST /config/verify — `data` payload after client unwrap. */
export type ConfigVerifyPostReturn = null;

/** GET /config/verify/{id} — `data` payload after client unwrap. */
export type ConfigVerifyIdGetReturn = {
  comment?: string;
  id: string;
  'ignore-verified'?: boolean | 0 | 1;
  'max-depth'?: number;
  ns?: string;
  'outdated-after'?: number;
  'read-threads'?: number;
  schedule?: string;
  store: string;
  'verify-threads'?: number;
};

/** PUT /config/verify/{id} — form/query parameters (path segments omitted). */
export type ConfigVerifyIdPutParams = {
  comment?: string;
  delete?: readonly (
    | 'ignore-verified'
    | 'comment'
    | 'schedule'
    | 'outdated-after'
    | 'ns'
    | 'max-depth'
    | 'read-threads'
    | 'verify-threads'
  )[];
  digest?: string;
  'ignore-verified'?: '0' | '1';
  'max-depth'?: string;
  ns?: string;
  'outdated-after'?: string;
  'read-threads'?: string;
  schedule?: string;
  store?: string;
  'verify-threads'?: string;
};
/** PUT /config/verify/{id} — `data` payload after client unwrap. */
export type ConfigVerifyIdPutReturn = null;

/** DELETE /config/verify/{id} — form/query parameters (path segments omitted). */
export type ConfigVerifyIdDeleteParams = { digest?: string };
/** DELETE /config/verify/{id} — `data` payload after client unwrap. */
export type ConfigVerifyIdDeleteReturn = null;
