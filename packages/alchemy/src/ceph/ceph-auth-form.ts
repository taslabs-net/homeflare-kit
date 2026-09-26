/**
 * `Ceph.AuthEntity`'s props/attributes shapes, the OpenBao paths it writes to, and the pure plan
 * function `diff` uses. Design: docs/plans/2026-09-26-ceph-mon-transport.md, "`Ceph.AuthEntity`
 * (K-A4)".
 *
 * ⛔ `entity` AND `mount` ARE IDENTITY — WHICH MEANS A CHANGE TO EITHER IS `replace`, NEVER
 *   `update`. The original header here argued a different entity/mount is simply a different
 *   resource id in the consuming stack, so this family would never need `replace`. That assumed
 *   the id and the identity move together; nothing enforces that they do — a declaration can keep
 *   its Alchemy id and edit `entity` or `mount` in place. LAND red team (2026-09-26), CONFIRMED:
 *   with `output` still naming the OLD entity, comparing caps alone answered `update`, and
 *   reconcile then ran `auth get`/`auth caps` against the NEW entity — a foreign or unrelated
 *   live entity — because `output !== undefined` skipped the "never adopted" refusal (which only
 *   fires when state is absent). `identityMoved` below is the guard, mirroring the
 *   `rename-identity.ts` pattern `Bao.SshRole` and its siblings use for the same shape of bug —
 *   except this family cannot ask `judgeMove`'s occupancy question at plan time (that would ssh),
 *   so there is no `replace`-onto-an-occupied-identity refusal here; reconcile's own
 *   `neverAdopted` check is what catches a moved identity landing on a live foreign entity,
 *   because a `replace`'s new generation always reconciles with `output: undefined`.
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

export type CephAuthEntityPlan = { readonly action: 'noop' | 'update' | 'replace' };

/**
 * Whether `output` (if any) names a different entity/mount than `news` declares — the one
 * question both `planCephAuthEntity` and `reconcileCephAuthEntity`'s guard ask, so the comparison
 * lives in exactly one place (rename-identity.ts's own header: "one description of which object,
 * not twelve copies of the check").
 */
export const identityMoved = (
  news: Pick<CephAuthEntityProps, 'entity' | 'mount'>,
  output: CephAuthEntityAttributes | undefined,
): boolean =>
  output !== undefined &&
  (output.entity !== news.entity || output.baoPath !== cephCliPath(news.mount, news.entity));

/**
 * ⛔ STATE ONLY, NO SSH — the design's own rule for this family ("a plan never elevates"; diff and
 *   verify compare props against state, never the live cluster). `output === undefined` returns
 *   `undefined`: a brand-new row plans as a create the same way every other family in this kit
 *   does, and reconcile is where the actual ssh work — and the key material — ever appears.
 *   A moved identity plans `replace` before caps are even considered: `defaultRemovalPolicy:
 *   'retain'` means the old generation is simply left alone (Apply.ts skips its delete under
 *   retain), and the new generation reconciles with `output: undefined`, which is exactly the
 *   "never adopted" path if the new identity already has a live entity.
 */
export const planCephAuthEntity = (
  news: CephAuthEntityProps,
  output: CephAuthEntityAttributes | undefined,
): CephAuthEntityPlan | undefined => {
  if (output === undefined) return undefined;
  if (identityMoved(news, output)) return { action: 'replace' };
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
