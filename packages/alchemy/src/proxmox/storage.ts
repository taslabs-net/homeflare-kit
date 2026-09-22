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
 *   "Permission check failed (/storage/local, Datastore.Allocate)". `pveOperations.read` folds
 *   every failure into `undefined`, i.e. "absent", because a 404 is a legitimate answer there and
 *   it cannot tell the two apart — so under that lease this resource NEVER CONVERGES, in two
 *   directions: reconcile reads "absent" and POSTs a create over a storage that is already defined,
 *   and where a create does land the read-back is 403 too, so reconcile dies with "the write
 *   returned no error but the object is still absent" about an object it has just built. Both
 *   messages point away from the cause.
 *   ★ SO WIDEN OR RE-POINT BEFORE THE FIRST PLAN, outside this file: give the credential mount's
 *     `read` role `Datastore.Allocate` on `/storage`, or read this family with `provision`. The
 *     provision role in the estate this was written for held only `Datastore.AllocateSpace` and
 *     `Datastore.Audit`, and NEITHER IS IT — AllocateSpace writes volumes INTO a storage, Allocate
 *     DEFINES one — so it 403'd here until widened the way `Pool.Allocate` was for `Proxmox.Pool`.
 *     The provisioning baseline (`provision-baseline.ts`) carries `Datastore.Allocate`.
 *
 * ⛔ THERE IS NO `password` PROP AND THERE MUST NEVER BE ONE. PBS and CIFS storages take one at
 *   create time, and Alchemy persists attributes UNENCRYPTED — a secret in props is one careless
 *   line away from being an attribute, and from there it is in the state store's nightly dump. So
 *   `StorageLocator` types `password`, `keyring` and `encryption-key` as `never`: declaring one is
 *   a COMPILE ERROR rather than a leak somebody finds in a backup months later. Set it once out of
 *   band (`pvesm set <id> --password`); PVE never returns it on read, so nothing here could diff it
 *   anyway.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { type PveRequirements, type WithTarget, pveHandlers } from './resource.ts';
import { bool, flag } from './values.ts';

/**
 * The create-time, plugin-specific half of a storage: `dir` wants `path`, `nfs` `server`+`export`,
 * `cifs` `server`+`share`, `pbs` `server`+`datastore`, `rbd` `pool`+`monhost`, `lvmthin`
 * `vgname`+`thinpool`, `zfspool` `pool`. A bag rather than two dozen named fields, because PVE
 * ships about that many plugins and each brings its own locator. ⚠️ Never diffed — see `matches`.
 *
 * ⛔ `password`, `keyring` AND `encryption-key` ARE `never` ON PURPOSE — see the ⛔ in the header.
 *   POSITIVE-CONTROLLED rather than assumed: all three are a compile error, `TS2322: Type 'string'
 *   is not assignable to type 'undefined'`.
 */
export type StorageLocator = Record<string, string> & {
  password?: never;
  keyring?: never;
  'encryption-key'?: never;
};

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
  /**
   * ⚠️ THE DEPRECATED PREDECESSOR OF `prune-backups`, and the two do not mix — declare one or the
   *   other. `0` means UNLIMITED to PVE rather than "unset", hence the `-1` in the attribute.
   */
  maxfiles?: number;
}

export interface StorageAttributes {
  storage: string;
  /** Reported so a plan can show what it points at; never diffed — see `type` above. */
  type: string;
  content: string;
  nodes: string;
  disable: boolean;
  shared: boolean;
  preallocation: string;
  'prune-backups': string;
  comment: string;
  /** ⚠️ `-1` means "no maxfiles in storage.cfg". `0` is a real setting meaning unlimited. */
  maxfiles: number;
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

const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);

const field = (name: string, value: string | undefined): Record<string, string> =>
  value === undefined ? {} : { [name]: value };

/**
 * ⚠️ THE CAST DROPS THE THREE `never` GUARDS AND NOTHING ELSE, and it is load-bearing rather than
 *   lazy: an intersection carrying OPTIONAL properties is not assignable to `Record<string,string>`
 *   at all, so the guards and the form body cannot both exist without one conversion. At runtime a
 *   locator is a plain string map; the guards only ever existed to fail a declaration.
 */
const locatorForm = (locator: StorageLocator | undefined) =>
  ({ ...locator }) as Record<string, string>;

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

const sameList = (declared: string | undefined, live: string) =>
  declared === undefined || tokens(declared) === tokens(live);

const same = <T>(declared: T | undefined, live: T) => declared === undefined || declared === live;

/**
 * The mutable half, for create and update alike.
 *
 * ⚠️ AN UNDECLARED FIELD IS NEITHER SENT NOR COMPARED: undeclared means UNMANAGED here, unlike
 *   `Proxmox.Pool` where an absent comment means `''`. A storage has no single default to fall back
 *   on — `content` defaults per plugin, and clearing a field needs an explicit `delete=` parameter
 *   rather than an empty value — so a guessed default would rewrite a storage somebody tuned by
 *   hand, and comparing one would report drift nobody declared.
 *
 * ⚠️ RECONCILE PUTs UNCONDITIONALLY whenever the object exists (resource.ts), so this form must be
 *   safe to re-apply to a storage that already matches. It is: the declared set and nothing else,
 *   and PVE leaves absent parameters alone.
 */
const mutable = (props: StorageProps): Record<string, string> => ({
  ...field('comment', props.comment),
  ...field('content', props.content),
  ...field('disable', flag(props.disable)),
  ...field('maxfiles', props.maxfiles === undefined ? undefined : String(props.maxfiles)),
  ...field('nodes', props.nodes),
  ...field('preallocation', props.preallocation),
  ...field('prune-backups', props['prune-backups']),
  ...field('shared', flag(props.shared)),
});

const handlers = pveHandlers<StorageProps, StorageAttributes>({
  // ⛔ PVE gates this family's ITEM read on the allocate privilege, not the audit one — see
  //   `readRole` in resource.ts. The auditor-shaped lease reads 403, which `read` turns into
  //   "absent", and the plan then says create for an object that is plainly there.
  readRole: 'provision',
  /**
   * ⚠️ `digest` IS DELIBERATELY NOT AN ATTRIBUTE. PVE returns one on every storage read and it
   *   covers storage.cfg as a FILE, not this section of it, so keeping it would rewrite this
   *   resource's state whenever an unrelated storage was edited — churn that reads like drift.
   */
  attributes: (live, props) => ({
    comment: str(live['comment']),
    content: str(live['content']),
    disable: bool(live['disable']),
    maxfiles: typeof live['maxfiles'] === 'number' ? live['maxfiles'] : -1,
    nodes: str(live['nodes']),
    preallocation: str(live['preallocation']),
    'prune-backups': str(live['prune-backups']),
    shared: bool(live['shared']),
    storage: props.storage,
    type: str(live['type'], props.type),
  }),
  collection: () => 'storage',
  /**
   * ⚠️ THE BAG IS SPREAD FIRST SO NOTHING IN IT CAN SHADOW A FIELD THIS RESOURCE MANAGES. A stray
   *   `storage` or `type` in a locator would otherwise rename the object being created, and PVE
   *   would build the wrong thing under a name Alchemy then records as the declared one.
   */
  createForm: (props) => ({
    ...locatorForm(props.locator),
    ...mutable(props),
    storage: props.storage,
    type: props.type,
  }),
  /**
   * ⚠️ `type` AND THE LOCATOR ARE NEVER COMPARED, AND AN UNDECLARED FIELD IS NOT COMPARED EITHER.
   *   PVE returns the create-only fields on read but refuses them on PUT, so diffing one could only
   *   plan an update that no write can apply: a plan that reports work on every run, forever.
   */
  /** The vendor rules these forms are checked against at plan time — resource-spec.ts. */
  endpoint: { create: 'pve:POST /storage', update: 'pve:PUT /storage/{storage}' },
  matches: (attributes, props) =>
    sameList(props.content, attributes.content) &&
    sameList(props.nodes, attributes.nodes) &&
    sameList(props['prune-backups'], attributes['prune-backups']) &&
    same(props.disable, attributes.disable) &&
    same(props.shared, attributes.shared) &&
    same(props.preallocation, attributes.preallocation) &&
    same(props.comment, attributes.comment) &&
    same(props.maxfiles, attributes.maxfiles),
  path: (props) => `storage/${props.storage}`,
  updateForm: mutable,
});

/**
* ⛔ EMPTY, AND HERE IT MATTERS MORE THAN ANYWHERE ELSE IN THIS PACKAGE. `GET /storage`
*   returns every definition on the cluster, `local` and `local-lvm`/`local-zfs` included:
*   the installer's own, that every guest's rootfs sits on. Adopting those would put
*   Alchemy one `delete` away from the cluster's disks. Adoption is explicit, always.
 
 *
* ⚠️ THIS REMOVES THE DEFINITION, NOT THE DATA. PVE drops the section from storage.cfg and
*   leaves the volumes on disk untouched — so the loss is not the bytes, it is that guests
*   whose config still names this storage can no longer resolve their own disks.
 
 */
export const ProxmoxStorageProvider = () =>
  Provider.effect(ProxmoxStorage, Effect.succeed(ProxmoxStorage.Provider.of(handlers)));
