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
 * `sub options` block. Extended 2026-09-27 (PR 314's own red team) to cover the five types the
 * first pass left unverified rather than guessed at; only these two lists moved:
 *
 *   accepts `shared` (`shared => { optional => 1 }`):
 *     DirPlugin.pm:85, LVMPlugin.pm:453, BTRFSPlugin.pm:69, ESXiPlugin.pm:52
 *
 *   `shared` is ABSENT from `options()` entirely — PVE's per-type accepted-key check refuses it
 *   on both create and update, whatever the combined apidoc schema shows:
 *     CephFSPlugin.pm, RBDPlugin.pm, ZFSPoolPlugin.pm, LvmThinPlugin.pm, NFSPlugin.pm,
 *     CIFSPlugin.pm, PBSPlugin.pm, ISCSIPlugin.pm, ISCSIDirectPlugin.pm, ZFSPlugin.pm (the remote
 *     ZFS-over-iSCSI plugin, distinct from `zfspool`)
 *
 * `storage-cephfs-tb4`'s PUT failure (measured 2026-09-27, `bun run deploy`,
 * `InternalServerError: update storage failed: unexpected property 'shared'`) is exactly this:
 * `cephfs` has no `shared` in its own `options()`, so the base class's generic `shared` property
 * (`PVE::Storage::Plugin`'s `$defaultData->{propertyList}`: `type => 'boolean', optional => 1`,
 * no `fixed`) is never in the accepted set for that plugin, whether or not the declared value
 * would have matched what PVE already has.
 *
 * ⚠️ STILL NOT EXHAUSTIVE. Every PVE plugin type is now checked against vendor source EXCEPT
 *   whatever ships after this file was last read — `sharedAccepted` treats an unrecognized type
 *   as NOT accepting `shared`, the safe default: a wrongly-excluded type just never sends a
 *   declared `shared` (storage-form.ts's `mutable`) and, if the declared value actually disagrees
 *   with what PVE reports, the plan dies loud rather than lying `noop` (storage-wire.ts's
 *   `matches`) — it does not risk a second `unexpected property` 500. Read a new plugin's own
 *   `options()` on github.com/proxmox/pve-storage before adding it to either list.
 */
const SHARED_ACCEPTED_TYPES: ReadonlySet<string> = new Set(['dir', 'lvm', 'btrfs', 'esxi']);

export const sharedAccepted = (type: string): boolean => SHARED_ACCEPTED_TYPES.has(type);
