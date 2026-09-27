/**
 * `Proxmox.Storage`'s WRITE side: the locator bag, the create/update forms, and the translation
 * into distilled's own typed request shape. Split out of storage-wire.ts (2026-09-24) to keep
 * both files under the 250-line cap — the api-token.ts/api-token-form.ts seam, same reasoning.
 */
import type * as storage from '@distilled.cloud/proxmox/storage';
import { sharedAccepted } from './storage-plugin-options.ts';
import type { StorageProps } from './storage.ts';
import { changedProps } from './storage-wire.ts';
import type { StorageAttributes } from './storage-wire.ts';
import { flag } from './values.ts';

export const STORAGE_CREATE = 'pve:POST /storage';
export const STORAGE_UPDATE = 'pve:PUT /storage/{storage}';

/**
 * The create-time, plugin-specific half of a storage: `dir` wants `path`, `nfs` `server`+`export`,
 * `cifs` `server`+`share`, `pbs` `server`+`datastore`, `rbd` `pool`+`monhost`, `lvmthin`
 * `vgname`+`thinpool`, `zfspool` `pool`. A bag rather than two dozen named fields, because PVE
 * ships about that many plugins and each brings its own locator. ⚠️ Never diffed — see `matches`
 * (storage-wire.ts).
 *
 * ⛔ `password`, `keyring` AND `encryption-key` ARE `never` ON PURPOSE — see the ⛔ in storage.ts's
 *   header. POSITIVE-CONTROLLED rather than assumed: all three are a compile error, `TS2322: Type
 *   'string' is not assignable to type 'undefined'`.
 * ⚠️ EVERY KEY IN THIS BAG GOES THROUGH `underscored` (below) BEFORE IT REACHES DISTILLED — see
 *   that function's own header. A caller writes PVE's own field names here (`fs-name`, matching
 *   `pvesm`/pve-docs), never distilled's renamed ones.
 */
export type StorageLocator = Record<string, string> & {
  password?: never;
  keyring?: never;
  'encryption-key'?: never;
};

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
 * ★ ROUTES EVERY OUTGOING FIELD THROUGH DISTILLED'S OWN TYPED PROPERTY, RATHER THAN THROUGH ITS
 *   "UNKNOWN KEY" FALLBACK — NOT BECAUSE THE WIRE NEEDS THE UNDERSCORED SPELLING. MEASURED both
 *   ways (`storage-read-failure.test.ts`'s create test, run once with this function and once
 *   without it): PVE's own hyphenated name (`content-dirs=…`) reaches the wire either way —
 *   `@distilled.cloud/proxmox`'s generated `T.Body("content-dirs")` annotation re-hyphenates its
 *   underscored `content_dirs` property on the way out, AND an untranslated hyphenated key also
 *   passes through unchanged as an "unknown key", form-encoded alongside the recognized ones (the
 *   GET-request version of that same passthrough is what caused kit 0.31.1's regression — see
 *   user.ts/group.ts — but a POST/PUT is already body-bearing, so the failure mode there doesn't
 *   apply). So EITHER path is wire-correct for a plain rename. What `underscored` buys instead:
 *   distilled's own schema only runs its declared per-field logic (a `T.Body()` rename, but also
 *   whatever type coercion or list-joining a FUTURE plugin field might carry) for a property it
 *   recognizes — an unrecognized key gets none of that, silently. `StorageLocator` is free-form
 *   on purpose (the header's own reasoning), so this file cannot enumerate every field a plugin
 *   might need; routing through the recognized property is the one way to get distilled's own
 *   per-field handling for a field this package's author never tried, rather than a bare rename.
 *   Renamed against every hyphenated field on the generated `CreateStorageRequest`/
 *   `PutStorageRequest` today (`prune-backups` -> `prune_backups`, `fs-name` -> `fs_name`,
 *   `max-protected-backups` -> `max_protected_backups`, `zfs-base-path` -> `zfs_base_path`,
 *   `content-dirs` -> `content_dirs`, `saferemove-stepsize` -> `saferemove_stepsize`, and so on) —
 *   a generic transform, not a lookup table, for the same free-form reason. No other migrated
 *   family (acl/group/role/user/api-token) hit any of this: none of their fields are hyphenated.
 * ⛔ NEVER APPLIED TO THE FORM `guardWrite` CHECKS, REGARDLESS. The generated vendor-constraint
 *   tables (`generated/constraints/pve-storage.ts`) are keyed by PVE's OWN hyphenated names —
 *   running this first would make every constraint on `prune-backups`, `fs-name`, etc. silently
 *   never match, the vendor check passing over a value it never actually inspected. `createForm`/
 *   `updateForm` stay hyphenated for exactly that reason; only `toDistilledCreate`/
 *   `toDistilledUpdate` (the actual SDK call, storage.ts's `reconcile`) apply this.
 */
const underscored = (form: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(form).map(([key, value]) => [key.replaceAll('-', '_'), value]));

/**
 * The 7 fields `mutable()` reads, narrowed out of `StorageProps` — not `StorageProps` itself, so
 * a partial diff (storage-wire.ts's `changedProps`, which carries none of `storage`/`locator`/
 * `target`) can satisfy this type directly.
 */
export type MutableFields = Pick<
  StorageProps,
  'comment' | 'content' | 'disable' | 'nodes' | 'preallocation' | 'prune-backups' | 'shared'
>;

/**
 * The mutable half, for create and update alike.
 *
 * ⚠️ AN UNDECLARED FIELD IS NEITHER SENT NOR COMPARED: undeclared means UNMANAGED here, unlike
 *   `Proxmox.Pool` where an absent comment means `''`. A storage has no single default to fall back
 *   on — `content` defaults per plugin, and clearing a field needs an explicit `delete=` parameter
 *   rather than an empty value — so a guessed default would rewrite a storage somebody tuned by
 *   hand, and comparing one would report drift nobody declared.
 *
 * ⚠️ RECONCILE PUTs UNCONDITIONALLY whenever the object exists (group.ts's own reconcile has the
 *   same note), so this form must be safe to re-apply to a storage that already matches. It is:
 *   the declared set and nothing else, and PVE leaves absent parameters alone.
 *
 * ★ KEPT HYPHENATED (`'prune-backups'`, PVE's own wire name), NOT DISTILLED'S UNDERSCORED
 *   `prune_backups` — this form is what `guardWrite` checks (storage.ts), and the generated
 *   vendor-constraint table is keyed by PVE's own names (`underscored`'s own header has the
 *   measured evidence). `toDistilledCreate`/`toDistilledUpdate` translate a COPY for the actual
 *   SDK call; this function and its callers never see the underscored form.
 *
 * ⛔ `shared` IS GATED BY TYPE — `sharedAccepted` (storage-plugin-options.ts, vendor-cited): most
 *   plugins refuse it outright ("unexpected property 'shared'", the measured bug this gate
 *   fixes), so it is dropped here regardless of what the caller passed, for both create and
 *   update alike — `type` is always required precisely so this gate can run on the FULL declared
 *   set at create time too, not only on a partial update diff.
 */
const mutable = (type: string, props: MutableFields) => ({
  ...field('comment', props.comment),
  ...field('content', props.content),
  ...field('disable', flag(props.disable)),
  ...field('nodes', props.nodes),
  ...field('preallocation', props.preallocation),
  ...field('prune-backups', props['prune-backups']),
  ...(sharedAccepted(type) ? field('shared', flag(props.shared)) : {}),
});

/**
 * ⚠️ THE BAG IS SPREAD FIRST SO NOTHING IN IT CAN SHADOW A FIELD THIS RESOURCE MANAGES. A stray
 *   `storage` or `type` in a locator would otherwise rename the object being created, and PVE
 *   would build the wrong thing under a name Alchemy then records as the declared one.
 * ★ HYPHENATED, THE WIRE SHAPE — `guardWrite` (storage.ts) checks this form directly; see
 *   `underscored`'s header for why translating it here would blind that check.
 */
export const createForm = (props: StorageProps): Record<string, string> => ({
  ...locatorForm(props.locator),
  ...mutable(props.type, props),
  storage: props.storage,
  type: props.type,
});

/**
 * ⚠️ `type` AND THE LOCATOR ARE NEVER SENT ON UPDATE — PVE's PUT refuses the create-only fields
 *   (`PutStorageRequest` has no `type`, and the plugin locator fields it does carry are for a
 *   different purpose: moving an existing volume, not re-pointing the definition), and comparing
 *   either could only plan an update that no write can apply: a plan that reports work forever.
 *
 * ★ PARTIAL ON A KNOWN LIVE OBJECT — THE FIX FOR THE MEASURED BUG. `live === undefined` means
 *   there is no live row to diff against yet (`diff()`'s own early sanity check, run before any
 *   read; and the "about to create" branch in `reconcile()`) and this returns the FULL declared
 *   set, same as before this change. Once `live` is a real read, only `changedProps`
 *   (storage-wire.ts) — the declared fields that actually differ from what PVE just reported —
 *   reach the wire. Before this, `reconcile` PUT the full declared set whenever ANYTHING
 *   differed, so a declared `shared` that already MATCHED live still rode along on every update;
 *   for `storage-cephfs-tb4` (`content` was the only real drift, measured 2026-09-27) that meant
 *   sending `shared` to a plugin whose own `options()` never accepts it (storage-plugin-options.ts
 *   has the vendor citation), and PVE answered `unexpected property 'shared'`.
 */
export const updateForm = (
  props: StorageProps,
  live: StorageAttributes | undefined,
): Record<string, string> => ({
  ...mutable(props.type, live === undefined ? props : changedProps(live, props)),
  storage: props.storage,
});

/**
 * The actual `createStorage` call body — `createForm`, translated once. See `underscored`.
 * ⚠️ `as unknown as` — same load-bearing cast as `locatorForm`'s own ⚠️: a plain
 *   `Record<string,string>` does not structurally overlap a named-field interface enough for
 *   TypeScript to accept a direct cast, even though every field it carries fits one of the
 *   interface's own (all-optional-but-two) properties.
 */
export const toDistilledCreate = (props: StorageProps): storage.CreateStorageRequest =>
  underscored(createForm(props)) as unknown as storage.CreateStorageRequest;

/**
 * The actual `putStorage` call body — translated once. See `toDistilledCreate`.
 * ⚠️ TAKES THE ALREADY-BUILT FORM, NOT `props`+`live` — storage.ts's `reconcile` computes
 *   `updateForm(news, before)` exactly ONCE and passes that SAME object here and to `guardWrite`,
 *   so the vendor-constraint check and the wire body can never diverge. Two independent calls to
 *   `updateForm`, each running its own `changedProps`, would still agree today, but "the guard
 *   checks what is actually sent" (the house rule this fix follows) should not depend on that.
 */
export const toDistilledUpdate = (form: Record<string, string>): storage.PutStorageRequest =>
  underscored(form) as unknown as storage.PutStorageRequest;
