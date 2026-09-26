/**
 * `Ceph.AuthEntity`'s props/attributes shapes, the OpenBao paths it writes to, and the pure plan
 * function `diff` uses. Design: docs/plans/2026-09-26-ceph-mon-transport.md, "`Ceph.AuthEntity`
 * (K-A4)".
 *
 * ⛔ `entity` AND `mount` ARE IDENTITY, NEVER DIFFED. The same reasoning as `Proxmox.CephPool`'s
 *   `node`/`name` (ceph-pool.ts): they are the address a declaration was made at, true by
 *   construction. A different entity or mount is a different resource id in the consuming stack,
 *   never an update to this one — which also means this family never needs a `replace` action,
 *   and so never needs its (permanently refused) `delete` to run for one.
 */
import { trimTrailingSlashes } from '../openbao/mount-path.ts';
import type { CephCaps } from './ceph-auth-parse.ts';

export type { CephCaps };

export type CephAuthEntityProps = {
  /** `client.k8s-<name>` — bounded by ceph-argv.ts's allowlist, checked on every transport call. */
  readonly entity: string;
  readonly caps: CephCaps;
  /** TB4 mon ssh destinations, tried in this order (D1). At least one. */
  readonly nodes: readonly string[];
  /** OpenBao KV-v2 mount holding Talos/Ceph material, e.g. `talos-c1` (D2). */
  readonly mount: string;
};

export type CephAuthEntityAttributes = {
  readonly entity: string;
  readonly caps: CephCaps;
  /** `sha256(key)`, hex — never the key itself. */
  readonly fingerprint: string;
  /** CLI-style path (`<mount>/ceph/<entity>`) — safe to persist and log; the key is not here. */
  readonly baoPath: string;
  /** Which mon actually answered the write that produced this row. Never key material. */
  readonly node: string;
};

export const capsEqual = (a: CephCaps, b: CephCaps): boolean =>
  a.mon === b.mon && a.osd === b.osd && a.mgr === b.mgr;

/** The CLI-style path an operator's `bao kv get` would use — what `baoPath` records. */
export const cephCliPath = (mount: string, entity: string): string =>
  `${trimTrailingSlashes(mount)}/ceph/${entity}`;

/**
 * The raw KV-v2 HTTP API path `../openbao/bao-http.ts`'s `baoRead`/`baoWrite` take — the CLI path
 * with `data/` inserted, the same segment `bao kv get`/`bao kv put` insert themselves
 * (`../talos/credentials.ts`'s header has the shipped-default bug this convention avoids: never
 * include `data/` in the CLI-style path itself, only here).
 */
export const cephDataPath = (mount: string, entity: string): string =>
  `${trimTrailingSlashes(mount)}/data/ceph/${entity}`;

export type CephAuthEntityPlan = { readonly action: 'noop' | 'update' };

/**
 * ⛔ STATE ONLY, NO SSH — the design's own rule for this family ("a plan never elevates"; diff and
 *   verify compare props against state, never the live cluster). `output === undefined` returns
 *   `undefined`: a brand-new row plans as a create the same way every other family in this kit
 *   does, and reconcile is where the actual ssh work — and the key material — ever appears.
 */
export const planCephAuthEntity = (
  news: CephAuthEntityProps,
  output: CephAuthEntityAttributes | undefined,
): CephAuthEntityPlan | undefined => {
  if (output === undefined) return undefined;
  return capsEqual(news.caps, output.caps) ? { action: 'noop' } : { action: 'update' };
};

export const attributesOf = (
  props: Pick<CephAuthEntityProps, 'caps' | 'entity' | 'mount'>,
  fingerprint: string,
  node: string,
): CephAuthEntityAttributes => ({
  baoPath: cephCliPath(props.mount, props.entity),
  caps: props.caps,
  entity: props.entity,
  fingerprint,
  node,
});
