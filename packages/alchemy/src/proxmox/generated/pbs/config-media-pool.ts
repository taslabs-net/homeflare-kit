/**
 * Generated proxmox-backup-server API types for `/config/media/pool` — DO NOT EDIT BY HAND.
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

/** GET /config/media-pool — `data` payload after client unwrap. */
export type ConfigMediaPoolGetReturn = readonly {
  allocation?: string;
  comment?: string;
  encrypt?: string;
  name: string;
  retention?: string;
  template?: string;
}[];

/** POST /config/media-pool — form/query parameters (path segments omitted). */
export type ConfigMediaPoolPostParams = {
  allocation?: string;
  comment?: string;
  encrypt?: string;
  name: string;
  retention?: string;
  template?: string;
};
/** POST /config/media-pool — `data` payload after client unwrap. */
export type ConfigMediaPoolPostReturn = null;

/** GET /config/media-pool/{name} — `data` payload after client unwrap. */
export type ConfigMediaPoolNameGetReturn = {
  allocation?: string;
  comment?: string;
  encrypt?: string;
  name: string;
  retention?: string;
  template?: string;
};

/** PUT /config/media-pool/{name} — form/query parameters (path segments omitted). */
export type ConfigMediaPoolNamePutParams = {
  allocation?: string;
  comment?: string;
  delete?: readonly ('allocation' | 'retention' | 'template' | 'encrypt' | 'comment')[];
  encrypt?: string;
  retention?: string;
  template?: string;
};
/** PUT /config/media-pool/{name} — `data` payload after client unwrap. */
export type ConfigMediaPoolNamePutReturn = null;

/** DELETE /config/media-pool/{name} — `data` payload after client unwrap. */
export type ConfigMediaPoolNameDeleteReturn = null;

/** GET /config/metrics — `data` payload after client unwrap. */
export type ConfigMetricsGetReturn = null;

/** GET /config/metrics/influxdb-http — `data` payload after client unwrap. */
export type ConfigMetricsInfluxdbHttpGetReturn = readonly {
  bucket?: string;
  comment?: string;
  enable?: boolean | 0 | 1;
  'max-body-size'?: number;
  name: string;
  organization?: string;
  token?: string;
  url: string;
  'verify-tls'?: boolean | 0 | 1;
}[];

/** POST /config/metrics/influxdb-http — form/query parameters (path segments omitted). */
export type ConfigMetricsInfluxdbHttpPostParams = {
  bucket?: string;
  comment?: string;
  enable?: '0' | '1';
  'max-body-size'?: `${number}`;
  name: string;
  organization?: string;
  token?: string;
  url: string;
  'verify-tls'?: '0' | '1';
};
/** POST /config/metrics/influxdb-http — `data` payload after client unwrap. */
export type ConfigMetricsInfluxdbHttpPostReturn = null;

/** GET /config/metrics/influxdb-http/{name} — `data` payload after client unwrap. */
export type ConfigMetricsInfluxdbHttpNameGetReturn = {
  bucket?: string;
  comment?: string;
  enable?: boolean | 0 | 1;
  'max-body-size'?: number;
  name: string;
  organization?: string;
  token?: string;
  url: string;
  'verify-tls'?: boolean | 0 | 1;
};

/** PUT /config/metrics/influxdb-http/{name} — form/query parameters (path segments omitted). */
export type ConfigMetricsInfluxdbHttpNamePutParams = {
  bucket?: string;
  comment?: string;
  delete?: readonly (
    | 'enable'
    | 'token'
    | 'bucket'
    | 'organization'
    | 'max-body-size'
    | 'verify-tls'
    | 'comment')[];
  digest?: string;
  enable?: '0' | '1';
  'max-body-size'?: `${number}`;
  organization?: string;
  token?: string;
  url?: string;
  'verify-tls'?: '0' | '1';
};
/** PUT /config/metrics/influxdb-http/{name} — `data` payload after client unwrap. */
export type ConfigMetricsInfluxdbHttpNamePutReturn = null;

/** DELETE /config/metrics/influxdb-http/{name} — form/query parameters (path segments omitted). */
export type ConfigMetricsInfluxdbHttpNameDeleteParams = { digest?: string };
/** DELETE /config/metrics/influxdb-http/{name} — `data` payload after client unwrap. */
export type ConfigMetricsInfluxdbHttpNameDeleteReturn = null;

/** GET /config/metrics/influxdb-udp — `data` payload after client unwrap. */
export type ConfigMetricsInfluxdbUdpGetReturn = readonly {
  comment?: string;
  enable?: boolean | 0 | 1;
  host: string;
  mtu?: number;
  name: string;
}[];

/** POST /config/metrics/influxdb-udp — form/query parameters (path segments omitted). */
export type ConfigMetricsInfluxdbUdpPostParams = {
  comment?: string;
  enable?: '0' | '1';
  host: string;
  mtu?: `${number}`;
  name: string;
};
/** POST /config/metrics/influxdb-udp — `data` payload after client unwrap. */
export type ConfigMetricsInfluxdbUdpPostReturn = null;

/** GET /config/metrics/influxdb-udp/{name} — `data` payload after client unwrap. */
export type ConfigMetricsInfluxdbUdpNameGetReturn = {
  comment?: string;
  enable?: boolean | 0 | 1;
  host: string;
  mtu?: number;
  name: string;
};

/** PUT /config/metrics/influxdb-udp/{name} — form/query parameters (path segments omitted). */
export type ConfigMetricsInfluxdbUdpNamePutParams = {
  comment?: string;
  delete?: readonly ('enable' | 'mtu' | 'comment')[];
  digest?: string;
  enable?: '0' | '1';
  host?: string;
  mtu?: `${number}`;
};
/** PUT /config/metrics/influxdb-udp/{name} — `data` payload after client unwrap. */
export type ConfigMetricsInfluxdbUdpNamePutReturn = null;

/** DELETE /config/metrics/influxdb-udp/{name} — form/query parameters (path segments omitted). */
export type ConfigMetricsInfluxdbUdpNameDeleteParams = { digest?: string };
/** DELETE /config/metrics/influxdb-udp/{name} — `data` payload after client unwrap. */
export type ConfigMetricsInfluxdbUdpNameDeleteReturn = null;

/** GET /config/notifications — `data` payload after client unwrap. */
export type ConfigNotificationsGetReturn = null;

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
