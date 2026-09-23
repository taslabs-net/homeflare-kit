/**
 * Generated pve-manager API types for `/cluster/sdn/ipams` — DO NOT EDIT BY HAND.
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

/** GET /cluster/sdn/ipams — form/query parameters (path segments omitted). */
export type ClusterSdnIpamsGetParams = { type?: 'netbox' | 'phpipam' | 'pve' };
/** GET /cluster/sdn/ipams — `data` payload after client unwrap. */
export type ClusterSdnIpamsGetReturn = readonly ({
  ipam: string;
  type: string;
} & Record<string, unknown>)[];

/** POST /cluster/sdn/ipams — form/query parameters (path segments omitted). */
export type ClusterSdnIpamsPostParams = {
  fingerprint?: string;
  ipam: string;
  'lock-token'?: string;
  section?: `${number}`;
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
  section?: `${number}`;
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

/** POST /cluster/sdn/lock — form/query parameters (path segments omitted). */
export type ClusterSdnLockPostParams = { 'allow-pending'?: '0' | '1' };
/** POST /cluster/sdn/lock — `data` payload after client unwrap. */
export type ClusterSdnLockPostReturn = string;

/** DELETE /cluster/sdn/lock — form/query parameters (path segments omitted). */
export type ClusterSdnLockDeleteParams = { force?: '0' | '1'; 'lock-token'?: string };
/** DELETE /cluster/sdn/lock — `data` payload after client unwrap. */
export type ClusterSdnLockDeleteReturn = null;

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
  delete?: readonly ('entries')[];
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
  ge?: `${number}`;
  le?: `${number}`;
  'lock-token'?: string;
  prefix: string;
  seq?: `${number}`;
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
  ge?: `${number}`;
  le?: `${number}`;
  'lock-token'?: string;
  prefix?: string;
  seq?: `${number}`;
};
/** PUT /cluster/sdn/prefix-lists/{id}/entries/{url_seq} — `data` payload after client unwrap. */
export type ClusterSdnPrefixListsIdEntriesUrl_seqPutReturn = null;

/** DELETE /cluster/sdn/prefix-lists/{id}/entries/{url_seq} — form/query parameters (path segments omitted). */
export type ClusterSdnPrefixListsIdEntriesUrl_seqDeleteParams = { 'lock-token'?: string };
/** DELETE /cluster/sdn/prefix-lists/{id}/entries/{url_seq} — `data` payload after client unwrap. */
export type ClusterSdnPrefixListsIdEntriesUrl_seqDeleteReturn = null;

/** POST /cluster/sdn/rollback — form/query parameters (path segments omitted). */
export type ClusterSdnRollbackPostParams = { 'lock-token'?: string; 'release-lock'?: '0' | '1' };
/** POST /cluster/sdn/rollback — `data` payload after client unwrap. */
export type ClusterSdnRollbackPostReturn = null;

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
  order: `${number}`;
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
