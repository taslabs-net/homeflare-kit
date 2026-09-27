/**
 * Which PVE storage plugin TYPES accept the `shared` property on write (create or update) — from
 * each plugin's own `options()` in vendor source, NOT the generic combined property list
 * `pve-apidoc` documentation carries (storage.ts's own header has that gap: apidoc.js merges
 * every plugin's fields into one flat list for display, so `shared` LOOKS like a plain valid
 * property of PUT /storage/{storage} there — `generated/pve/storage.ts`'s own
 * `StorageStoragePutParams.shared` came from exactly that merged list, and so did the constraint
 * codegen's own inclusion of `shared` as a recognized wire field). The check PVE actually runs is
 * PER STORAGE TYPE, against that concrete plugin's own `options()` accepted-key set
 * (PVE::SectionConfig) — a key the plugin never names is refused outright, which is why a cephfs
 * PUT carrying `shared` answers `unexpected property 'shared'` even though the apidoc schema and
 * the generated wire types both carry the field.
 *
 * MEASURED against github.com/proxmox/pve-storage (the official read-only GitHub mirror of
 * git.proxmox.com/pve-storage.git), branch `master`, read 2026-09-27 — each plugin's own
 * `sub options` block:
 *
 *   accepts `shared` (`shared => { optional => 1 }`):
 *     DirPlugin.pm, LVMPlugin.pm
 *
 *   `shared` is ABSENT from `options()` entirely — PVE's per-type accepted-key check refuses it
 *   on both create and update, whatever the combined apidoc schema shows:
 *     CephFSPlugin.pm, RBDPlugin.pm, ZFSPoolPlugin.pm, LvmThinPlugin.pm, NFSPlugin.pm,
 *     CIFSPlugin.pm, PBSPlugin.pm
 *
 * `storage-cephfs-tb4`'s PUT failure (measured 2026-09-27, `bun run deploy`,
 * `InternalServerError: update storage failed: unexpected property 'shared'`) is exactly this:
 * `cephfs` has no `shared` in its own `options()`, so the base class's generic `shared` property
 * (`PVE::Storage::Plugin`'s `$defaultData->{propertyList}`: `type => 'boolean', optional => 1`,
 * no `fixed`) is never in the accepted set for that plugin, whether or not the declared value
 * would have matched what PVE already has.
 *
 * ⚠️ NOT EXHAUSTIVE. `btrfs`, `esxi`, `iscsi`, `iscsidirect` and `zfs` (the remote ZFS-over-iSCSI
 *   plugin, distinct from `zfspool`) are UNVERIFIED — absent from both lists below rather than
 *   guessed, per the house schema-provenance rule (never assume a constraint that was not
 *   checked against current vendor source). `sharedAccepted` therefore treats every unverified
 *   type as NOT accepting `shared`: the safe default, since it only means a declared `shared` on
 *   one of those five is silently never sent rather than possibly crashing the PUT. Read that
 *   plugin's own `options()` on github.com/proxmox/pve-storage and add it to the accepted set
 *   once someone actually needs `shared` on one of those five.
 */
const SHARED_ACCEPTED_TYPES: ReadonlySet<string> = new Set(['dir', 'lvm']);

export const sharedAccepted = (type: string): boolean => SHARED_ACCEPTED_TYPES.has(type);
