/**
 * `Proxmox.Storage`'s READ side: how a live item becomes attributes, the read itself, and
 * `matches`. Split out of storage.ts (2026-09-24, the distilled migration); the write side is
 * storage-form.ts (that file's own header has the reasoning) — both stay under the 250-line cap,
 * the api-token.ts/api-token-form.ts seam.
 */
import * as storage from '@distilled.cloud/proxmox/storage';
import * as Effect from 'effect/Effect';
import { runPve } from './distilled-pve.ts';
import type { StorageProps } from './storage.ts';
import { UNREADABLE, type Unreadable, readOrUnreadable } from './unreadable-read.ts';
import { bool } from './values.ts';

export interface StorageAttributes {
  storage: string;
  /** Reported so a plan can show what it points at; never diffed — storage.ts's `type` doc. */
  type: string;
  content: string;
  nodes: string;
  disable: boolean;
  shared: boolean;
  preallocation: string;
  'prune-backups': string;
  comment: string;
}

const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);

/**
 * ⚠️ PVE RE-SERIALISES ITS LIST FIELDS IN ITS OWN ORDER — `content` and `nodes` are parsed into a
 *   set and written back sorted, `prune-backups` is a property string that comes back in schema
 *   order. Comparing raw strings would report an update for `iso,backup` against `backup,iso` on
 *   every plan, and the PUT would "fix" it into the identical string. Trimming matters too: a
 *   declared `iso, backup` would otherwise never equal what PVE stores.
 */
const tokens = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .sort()
    .join(',');

export const sameList = (declared: string | undefined, live: string) =>
  declared === undefined || tokens(declared) === tokens(live);

export const same = <T>(declared: T | undefined, live: T) =>
  declared === undefined || declared === live;

/**
 * ⚠️ `digest` IS DELIBERATELY NOT AN ATTRIBUTE. PVE returns one on every storage read and it
 *   covers storage.cfg as a FILE, not this section of it, so keeping it would rewrite this
 *   resource's state whenever an unrelated storage was edited — churn that reads like drift.
 * ⛔ `maxfiles` IS NOT REPORTED, AND `StorageProps.maxfiles` NO LONGER EXISTS — see storage.ts's
 *   header for the measured SDK gap this reflects.
 */
const attributesOf = (live: unknown, props: StorageProps): StorageAttributes => {
  const data = live as Record<string, unknown>;
  return {
    comment: str(data['comment']),
    content: str(data['content']),
    disable: bool(data['disable']),
    nodes: str(data['nodes']),
    preallocation: str(data['preallocation']),
    'prune-backups': str(data['prune-backups']),
    shared: bool(data['shared']),
    storage: props.storage,
    type: str(data['type'], props.type),
  };
};

/**
 * ★ Default `read` role WOULD READ 403 — see storage.ts's header on why this family reads with
 *   `provision`, the same as acl.ts and unlike group.ts/user.ts.
 * ⛔ `{ storage: props.storage }`, NEVER THE WHOLE `props` — user.ts/group.ts's own ⛔, the
 *   kit 0.31.1 regression: `GetStorageRequest`'s schema declares only `storage` (a path label);
 *   any OTHER key on the object passed to `storage.getStorage` is treated by distilled's
 *   `buildRequest` as an "unknown key" and JSON-encoded onto this bodyless GET, which a stricter
 *   fetch client refuses outright.
 * ⛔ A MISSING STORAGE IS A 500, NOT A 404 — MEASURED against the live cluster (TB4, 2026-09-24,
 *   admin lane, read-only probe): `GET /storage/hf-measure-nonexistent-probe` answers
 *   `{"message":"storage 'hf-measure-nonexistent-probe' does not exist\n","data":null}` at HTTP
 *   500 — the SAME shape as user.ts's and group.ts's own measured 500, not the clean
 *   `{"data":null}` at 200 this file's pre-migration comment assumed for every read failure
 *   (client.ts's `pveOperations.read` could not tell the two apart either way, folding both into
 *   "absent"). `readStorage` below (used by `read`/`reconcile`) still folds it, exactly as
 *   `readUser`/`readGroup` do, so a brand-new declaration can still be created; `readStorageOrFail`
 *   (used by `diff`) does not.
 */
export const readStorageOrFail = (props: StorageProps) =>
  readOrUnreadable(
    runPve(props.target, 'provision', false, storage.getStorage({ storage: props.storage })),
  ).pipe(Effect.map((live) => (live === UNREADABLE ? UNREADABLE : attributesOf(live, props))));

/**
 * ⛔ ONLY `StorageNotFound` MEANS ABSENT. The initial distilled transport swap preserved a
 *   catch-all fold because PVE reports missing objects as HTTP 500. SDK PR 265 now types that
 *   measured message, so permission errors, unrelated 500s and exhausted transports propagate
 *   instead of triggering a speculative create (decision 49 follow-up, 2026-09-24).
 * ★ `readStorageOrFail` remains the strict path used for an already-confirmed state row. This
 *   change narrows cold reads/reconcile without changing that existing drift/diff contract.
 */
export const readStorage = (props: StorageProps) =>
  readStorageOrFail(props).pipe(
    Effect.catchTag('StorageNotFound', () => Effect.succeed(undefined)),
  );

/** `read`/`reconcile` return `Attributes | undefined`; only `diff` tells `UNREADABLE` apart. */
export const dropUnreadable = (live: StorageAttributes | Unreadable | undefined) =>
  live === UNREADABLE ? undefined : live;

/**
 * ⚠️ `type` IS NEVER COMPARED — CREATE-ONLY (`storage.ts`'s own `StorageProps.type` doc), so a
 *   changed declaration plans `noop` on it, same as before the migration.
 */
export const matches = (attributes: StorageAttributes, props: StorageProps) =>
  sameList(props.content, attributes.content) &&
  sameList(props.nodes, attributes.nodes) &&
  sameList(props['prune-backups'], attributes['prune-backups']) &&
  same(props.disable, attributes.disable) &&
  same(props.shared, attributes.shared) &&
  same(props.preallocation, attributes.preallocation) &&
  same(props.comment, attributes.comment);
