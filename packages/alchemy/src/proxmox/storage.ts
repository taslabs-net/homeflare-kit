/**
 * `Proxmox.Storage` — one entry in `/etc/pve/storage.cfg`, declared. Cluster-scoped like a pool,
 * which is why `path` and `collection` carry no node segment though a storage is used per node.
 *
 * ★ THIS IS THE OBJECT EVERY CONTAINER ALREADY DEPENDS ON AND NOTHING DECLARES. `LxcProps.storage`
 *   and the prefix of `LxcProps.ostemplate` (`local:vztmpl/...`) are bare strings, so a container's
 *   rootfs points at something outside the graph: rebuild a node and the plan still reads `noop`
 *   right up to the create that fails because the storage is not there. Passing this resource's
 *   `storage` attribute into `LxcProps.storage` makes the dependency real — Alchemy orders by data
 *   flow, so the storage reconciles first because the container reads a value out of it.
 *
 * ⛔ ONE PRIVILEGE COVERS THIS WHOLE FAMILY AND IT IS `Datastore.Allocate` ON `/storage`. Create,
 *   update, delete AND the single-object read all check it — `Datastore.Audit` is not enough for
 *   any of them. MEASURED: `GET /storage/local` under the auditor-scoped `read` lease answers 403
 *   "Permission check failed (/storage/local, Datastore.Allocate)". So this family reads with
 *   `provision`, same as acl.ts and unlike group.ts/user.ts — `provision-baseline.ts` carries
 *   `Datastore.Allocate`.
 *
 * ⛔ ON A LANE WHOSE CREDENTIAL CANNOT MINT `provision` (the agent's `read`-role lane), THIS
 *   FAMILY SHIPPED WITH THE ORIGINAL CRIES-WOLF BUG — measured live, 2026-09-24: `bun run plan`
 *   showed all 5 storages (`cephfs-tb4`, `cephtb4`, `local`, `local-zfs`, `pbs`) as `update`, with
 *   no warning, because `client.ts`'s `pveOperations.read` folded the REFUSED mint into `undefined`
 *   the same way it folds a genuine absence — `unreadable-read.ts`'s own header names this family
 *   by name as one of the two the fix was written for. Migrated here the way acl.ts/group.ts/
 *   user.ts were (kit 0.31.1/0.31.2): a refused `provision` mint now reports `noop` with a logged
 *   warning instead of forcing `update` with nothing compared.
 *
 * ⛔ A MISSING STORAGE IS A 500, NOT A 404 — MEASURED against the live cluster (TB4, 2026-09-24,
 *   admin lane, read-only `GET /storage/hf-measure-nonexistent-probe`): `{"message":"storage
 *   '...' does not exist\n"}` at HTTP 500. `storage-wire.ts`'s `readStorageOrFail`/`readStorage`
 *   carry the same dual-path split as user.ts/group.ts for exactly this reason — see that file.
 *
 * ⛔ `maxfiles` IS GONE — A MEASURED `@distilled.cloud/proxmox` SDK GAP, NOT A SCOPE TRIM. The
 *   vendor's generated `CreateStorageRequest`/`PutStorageRequest` (storage-wire.ts's `mutable`)
 *   have no `maxfiles` field at all — grepped across the whole package, not just this endpoint —
 *   where `prune-backups`, its documented replacement, is present and correctly wired
 *   (`T.Body("prune-backups")` on the generated `prune_backups` property). Silently dropping a
 *   declared `maxfiles` value would have been the same class of bug this whole migration exists to
 *   close: a write that looks like it landed and did not. So `maxfiles?: never` below, the same
 *   COMPILE-ERROR treatment `StorageLocator`'s `password`/`keyring`/`encryption-key` already get —
 *   a declaration that sets it is refused before a plan ever runs, not silently ignored by one.
 *   None of this cluster's 5 live storages set it (measured, live response bodies below). If a
 *   consumer genuinely needs it, the fix belongs in `@distilled.cloud/proxmox`'s generator, not a
 *   hand-rolled bypass here — see the provider-walk-down doctrine on vendor gaps.
 *
 * ⛔ EVERY HYPHENATED PVE FIELD NAME BECOMES AN UNDERSCORE IN DISTILLED'S GENERATED TYPESCRIPT —
 *   MEASURED across the WHOLE generated `CreateStorageRequest`/`PutStorageRequest`, not one field:
 *   `prune-backups` -> `prune_backups`, `fs-name` -> `fs_name`, `max-protected-backups` ->
 *   `max_protected_backups`, and so on for every plugin field `StorageLocator`'s free-form bag can
 *   carry (`cephfs-tb4`'s own live locator uses `fs-name`, measured below). No other family
 *   migrated so far has a hyphenated field at all, so this is new here. `storage-wire.ts`'s
 *   `underscored` translates a form BUILT with PVE's own names into distilled's shape, but ONLY
 *   for the actual SDK call (`toDistilledCreate`/`toDistilledUpdate`) — never for the form
 *   `guardWrite` checks (`createForm`/`updateForm`), which the generated vendor-constraint tables
 *   key by PVE's own hyphenated names. Running the translation before that check would make it
 *   silently stop inspecting the very fields it exists to catch.
 *
 * ⛔ THERE IS NO `password` PROP AND THERE MUST NEVER BE ONE. PBS and CIFS storages take one at
 *   create time, and Alchemy persists attributes UNENCRYPTED — a secret in props is one careless
 *   line away from being an attribute, and from there it is in the state store's nightly dump. So
 *   `StorageLocator` types `password`, `keyring` and `encryption-key` as `never`: declaring one is
 *   a COMPILE ERROR rather than a leak somebody finds in a backup months later. Set it once out of
 *   band (`pvesm set <id> --password`); PVE never returns it on read, so nothing here could diff it
 *   anyway.
 *
 * ★ MIGRATED OFF `client.ts`'s generic `pve()`/`pveHandlers` (`resource.ts`) ONTO
 *   `@distilled.cloud/proxmox`'s typed `storage.getStorage`/`createStorage`/`putStorage`/
 *   `deleteStorage` (2026-09-24, decision 43's proxmox walk-down, nodes/storage sub-area, first
 *   resource). `distilled-pve.ts`'s `runPve` replaces `pve()`; the cries-wolf fix is wired the
 *   same way as acl.ts/group.ts/user.ts.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as storage from '@distilled.cloud/proxmox/storage';
import * as Effect from 'effect/Effect';
import { guardWrite } from './distilled-guard.ts';
import type { PveRequirements, WithTarget } from './resource-spec.ts';
import { runPve } from './distilled-pve.ts';
import {
  STORAGE_CREATE,
  STORAGE_UPDATE,
  createForm,
  toDistilledCreate,
  toDistilledUpdate,
  updateForm,
} from './storage-form.ts';
import { dropUnreadable, matches, readStorage, readStorageOrFail } from './storage-wire.ts';
import { UNREADABLE, unreadableWarning } from './unreadable-read.ts';
import type { StorageAttributes } from './storage-wire.ts';
import type { StorageLocator } from './storage-form.ts';

/** Re-exported so a caller of this file still finds them here, unchanged by the split below. */
export type { StorageAttributes, StorageLocator };

export interface StorageProps extends WithTarget {
  /** PVE's primary key, cluster-wide — the string an LXC's `storage` and `ostemplate` name. */
  storage: string;
  /**
   * `dir` | `nfs` | `cifs` | `pbs` | `zfspool` | `lvmthin` | `rbd` | … ⚠️ CREATE-ONLY, so a changed
   * `type` plans as `noop` (see `matches`). PVE cannot retype a storage: remove and redeclare.
   */
  type: string;
  /** ⚠️ Create-only, one shape per plugin. See `StorageLocator`. */
  locator?: StorageLocator;
  /** `images,rootdir,vztmpl,iso,backup,snippets`. PVE reports `none` for an empty set. */
  content?: string;
  /**
   * Node restriction, e.g. `node-a,node-b`. ⚠️ A STORAGE WITH A `nodes` LIST DOES NOT EXIST ANYWHERE ELSE:
   * an LXC declared on a node outside it fails at create with "storage not available on node".
   */
  nodes?: string;
  /** Keeps the definition but stops PVE using it. */
  disable?: boolean;
  /** Tells PVE the same volumes are visible from every node — a claim, not a mechanism. */
  shared?: boolean;
  /** `off` | `metadata` | `falloc` | `full`. File-based plugins only. */
  preallocation?: string;
  /**
   * `keep-last=3,keep-daily=7,…`. ⚠️ THE WIRE NAME IS KEPT, HYPHEN AND ALL: a `pruneBackups` that
   * quietly becomes `prune-backups` in the form body is a second name for one thing.
   */
  'prune-backups'?: string;
  comment?: string;
  /** ⛔ REMOVED — a measured `@distilled.cloud/proxmox` gap, not a scope trim. See the header. */
  maxfiles?: never;
}

export interface ProxmoxStorage extends Resource<
  'Proxmox.Storage',
  StorageProps,
  StorageAttributes,
  never,
  PveRequirements
> {}

/** ★ `retain` by default — a storage holding volumes cannot be rebuilt. See the ★ in resource.ts. */
export const ProxmoxStorage = Resource<ProxmoxStorage>('Proxmox.Storage', {
  defaultRemovalPolicy: 'retain',
});

export const ProxmoxStorageProvider = () =>
  Provider.effect(
    ProxmoxStorage,
    Effect.succeed(
      ProxmoxStorage.Provider.of({
        /**
         * ⛔ EMPTY, AND HERE IT MATTERS MORE THAN ANYWHERE ELSE IN THIS PACKAGE. `GET /storage`
         *   returns every definition on the cluster, `local` and `local-lvm`/`local-zfs` included:
         *   the installer's own, that every guest's rootfs sits on. Adopting those would put
         *   Alchemy one `delete` away from the cluster's disks. Adoption is explicit, always.
         */
        list: () => Effect.succeed([]),
        // ⚠️ FOLDS ONLY WHEN `output` IS `undefined` — user.ts's/group.ts's own ⚠️, applied here
        //   from the start rather than found by a later review: the engine calls this hook from
        //   Plan.ts's adoption probe and interrupted-create recovery and Apply.ts's delete
        //   recovery (all `output: undefined`, nothing confirmed exists yet — `readStorage`'s fold
        //   is still needed) as well as Drift.ts (`output: old.attr`, an ALREADY-CONFIRMED row,
        //   `diff`'s own situation — `readStorageOrFail` there instead, or a transient failure
        //   reports a silent `{action: 'missing'}` with no error at all).
        read: Effect.fn(function* ({ olds, output }) {
          return dropUnreadable(
            yield* output === undefined ? readStorage(olds) : readStorageOrFail(olds),
          );
        }),
        diff: Effect.fn(function* ({ news, output }) {
          if (!isResolved(news)) return undefined;
          yield* guardWrite(STORAGE_CREATE, createForm(news), output === undefined);
          yield* guardWrite(STORAGE_UPDATE, updateForm(news), false);
          if (output === undefined) return undefined;
          // ⚠️ `readStorageOrFail`, NOT `readStorage` — see that function's own ⛔ in
          //   storage-wire.ts. A genuine TRANSIENT failure here propagates and fails the whole
          //   plan loudly instead of folding to "absent" and forcing a false update.
          const live = yield* readStorageOrFail(news);
          // ⛔ THE CRIES-WOLF FIX: a refused read used to fall into `undefined` below and force
          //   `update` on a storage that was plainly there — see unreadable-read.ts.
          if (live === UNREADABLE) {
            yield* unreadableWarning('Proxmox.Storage', news.storage);
            return { action: 'noop' } as const;
          }
          if (live === undefined) {
            yield* guardWrite(STORAGE_CREATE, createForm(news), true);
            return { action: 'update' } as const;
          }
          return matches(live, news)
            ? ({ action: 'noop' } as const)
            : ({ action: 'update' } as const);
        }),
        reconcile: Effect.fn(function* ({ news }) {
          // ⚠️ `dropUnreadable`: reconcile only runs once `provision` already minted for the
          //   write below, so `UNREADABLE` here is a narrow race, not the routine case `diff`
          //   handles — group.ts's/user.ts's reconcile have the same note.
          const before = dropUnreadable(yield* readStorage(news));
          yield* guardWrite(STORAGE_CREATE, createForm(news), before === undefined);
          yield* guardWrite(STORAGE_UPDATE, updateForm(news), false);
          if (before === undefined) {
            yield* runPve(
              news.target,
              'provision',
              true,
              storage.createStorage(toDistilledCreate(news)),
            );
          } else if (!matches(before, news)) {
            yield* runPve(
              news.target,
              'provision',
              true,
              storage.putStorage(toDistilledUpdate(news)),
            );
          }
          const after = dropUnreadable(yield* readStorage(news));
          if (after === undefined) {
            return yield* Effect.die(
              new Error(
                `storage/${news.storage}: the write returned no error but the storage is still ` +
                  'absent. PVE wraps every answer in {"data":...} and can report success on a ' +
                  'call that did nothing -- read back rather than trusting the status code.',
              ),
            );
          }
          return after;
        }),
        /**
         * ⚠️ THIS REMOVES THE DEFINITION, NOT THE DATA. PVE drops the section from storage.cfg and
         *   leaves the volumes on disk untouched — so the loss is not the bytes, it is that guests
         *   whose config still names this storage can no longer resolve their own disks.
         */
        delete: Effect.fn(function* ({ olds }) {
          yield* runPve(
            olds.target,
            'provision',
            true,
            storage.deleteStorage({ storage: olds.storage }),
          );
        }),
      }),
    ),
  );
