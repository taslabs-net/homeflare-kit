/**
 * Generated pve-manager API types for `/cluster/metrics` — DO NOT EDIT BY HAND.
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

/** GET /cluster/metrics — `data` payload after client unwrap. */
export type ClusterMetricsGetReturn = readonly Record<string, unknown>[];

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
  'max-body-size'?: `${number}`;
  mtu?: `${number}`;
  organization?: string;
  'otel-compression'?: 'none' | 'gzip';
  'otel-headers'?: string;
  'otel-max-body-size'?: `${number}`;
  'otel-path'?: string;
  'otel-protocol'?: 'http' | 'https';
  'otel-resource-attributes'?: string;
  'otel-timeout'?: `${number}`;
  'otel-verify-ssl'?: '0' | '1';
  path?: string;
  port: `${number}`;
  proto?: 'udp' | 'tcp';
  server: string;
  timeout?: `${number}`;
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
  'max-body-size'?: `${number}`;
  mtu?: `${number}`;
  organization?: string;
  'otel-compression'?: 'none' | 'gzip';
  'otel-headers'?: string;
  'otel-max-body-size'?: `${number}`;
  'otel-path'?: string;
  'otel-protocol'?: 'http' | 'https';
  'otel-resource-attributes'?: string;
  'otel-timeout'?: `${number}`;
  'otel-verify-ssl'?: '0' | '1';
  path?: string;
  port: `${number}`;
  proto?: 'udp' | 'tcp';
  server: string;
  timeout?: `${number}`;
  token?: string;
  'verify-certificate'?: '0' | '1';
};
/** PUT /cluster/metrics/server/{id} — `data` payload after client unwrap. */
export type ClusterMetricsServerIdPutReturn = null;

/** DELETE /cluster/metrics/server/{id} — `data` payload after client unwrap. */
export type ClusterMetricsServerIdDeleteReturn = null;

/** GET /cluster/metrics/export — form/query parameters (path segments omitted). */
export type ClusterMetricsExportGetParams = {
  history?: '0' | '1';
  'local-only'?: '0' | '1';
  'node-list'?: string;
  'start-time'?: `${number}`;
};
/** GET /cluster/metrics/export — `data` payload after client unwrap. */
export type ClusterMetricsExportGetReturn = {
  data: readonly {
    id: string;
    metric: string;
    timestamp: number;
    type: 'gauge' | 'counter' | 'derive';
    value: number;
  }[];
};

/** GET /cluster/nextid — form/query parameters (path segments omitted). */
export type ClusterNextidGetParams = { vmid?: `${number}` };
/** GET /cluster/nextid — `data` payload after client unwrap. */
export type ClusterNextidGetReturn = number;

/** GET /cluster/notifications — `data` payload after client unwrap. */
export type ClusterNotificationsGetReturn = readonly Record<string, unknown>[];
