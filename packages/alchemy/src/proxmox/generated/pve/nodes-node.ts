/**
 * Generated pve-manager API types for `/nodes/node` — DO NOT EDIT BY HAND.
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
  min_size?: `${number}`;
  name: string;
  pg_autoscale_mode?: 'on' | 'off' | 'warn';
  pg_num?: `${number}`;
  pg_num_min?: `${number}`;
  size?: `${number}`;
  target_size?: string;
  target_size_ratio?: `${number}`;
};
/** POST /nodes/{node}/ceph/pool — `data` payload after client unwrap. */
export type NodesNodeCephPoolPostReturn = string;

/** GET /nodes/{node}/ceph/pool/{name} — `data` payload after client unwrap. */
export type NodesNodeCephPoolNameGetReturn = readonly Record<string, unknown>[];

/** PUT /nodes/{node}/ceph/pool/{name} — form/query parameters (path segments omitted). */
export type NodesNodeCephPoolNamePutParams = {
  application?: 'rbd' | 'cephfs' | 'rgw';
  crush_rule?: string;
  min_size?: `${number}`;
  pg_autoscale_mode?: 'on' | 'off' | 'warn';
  pg_num?: `${number}`;
  pg_num_min?: `${number}`;
  size?: `${number}`;
  target_size?: string;
  target_size_ratio?: `${number}`;
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
  timeout?: `${number}`;
};
/** POST /nodes/{node}/ceph/restart-bulk — `data` payload after client unwrap. */
export type NodesNodeCephRestartBulkPostReturn = string;

/** GET /nodes/{node}/ceph/rules — `data` payload after client unwrap. */
export type NodesNodeCephRulesGetReturn = readonly ({ name: string } & Record<string, unknown>)[];

/** POST /nodes/{node}/ceph/start — form/query parameters (path segments omitted). */
export type NodesNodeCephStartPostParams = { service?: string };
/** POST /nodes/{node}/ceph/start — `data` payload after client unwrap. */
export type NodesNodeCephStartPostReturn = string;

/** GET /nodes/{node}/ceph/status — `data` payload after client unwrap. */
export type NodesNodeCephStatusGetReturn = unknown;

/** POST /nodes/{node}/ceph/stop — form/query parameters (path segments omitted). */
export type NodesNodeCephStopPostParams = { service?: string };
/** POST /nodes/{node}/ceph/stop — `data` payload after client unwrap. */
export type NodesNodeCephStopPostReturn = string;

/** GET /nodes/{node}/certificates — `data` payload after client unwrap. */
export type NodesNodeCertificatesGetReturn = readonly Record<string, unknown>[];

/** GET /nodes/{node}/certificates/acme — `data` payload after client unwrap. */
export type NodesNodeCertificatesAcmeGetReturn = readonly Record<string, unknown>[];

/** POST /nodes/{node}/certificates/acme/certificate — form/query parameters (path segments omitted). */
export type NodesNodeCertificatesAcmeCertificatePostParams = { force?: '0' | '1' };
/** POST /nodes/{node}/certificates/acme/certificate — `data` payload after client unwrap. */
export type NodesNodeCertificatesAcmeCertificatePostReturn = string;

/** PUT /nodes/{node}/certificates/acme/certificate — form/query parameters (path segments omitted). */
export type NodesNodeCertificatesAcmeCertificatePutParams = { force?: '0' | '1' };
/** PUT /nodes/{node}/certificates/acme/certificate — `data` payload after client unwrap. */
export type NodesNodeCertificatesAcmeCertificatePutReturn = string;

/** DELETE /nodes/{node}/certificates/acme/certificate — `data` payload after client unwrap. */
export type NodesNodeCertificatesAcmeCertificateDeleteReturn = string;

/** GET /nodes/{node}/certificates/info — `data` payload after client unwrap. */
export type NodesNodeCertificatesInfoGetReturn = readonly ({
  filename?: string;
  fingerprint?: string;
  issuer?: string;
  notafter?: number;
  notbefore?: number;
  pem?: string;
  'public-key-bits'?: number;
  'public-key-type'?: string;
  san?: readonly string[];
  subject?: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/certificates/custom — form/query parameters (path segments omitted). */
export type NodesNodeCertificatesCustomPostParams = {
  certificates: string;
  force?: '0' | '1';
  key?: string;
  restart?: '0' | '1';
};
/** POST /nodes/{node}/certificates/custom — `data` payload after client unwrap. */
export type NodesNodeCertificatesCustomPostReturn = {
  filename?: string;
  fingerprint?: string;
  issuer?: string;
  notafter?: number;
  notbefore?: number;
  pem?: string;
  'public-key-bits'?: number;
  'public-key-type'?: string;
  san?: readonly string[];
  subject?: string;
} & Record<string, unknown>;

/** DELETE /nodes/{node}/certificates/custom — form/query parameters (path segments omitted). */
export type NodesNodeCertificatesCustomDeleteParams = { restart?: '0' | '1' };
/** DELETE /nodes/{node}/certificates/custom — `data` payload after client unwrap. */
export type NodesNodeCertificatesCustomDeleteReturn = null;
