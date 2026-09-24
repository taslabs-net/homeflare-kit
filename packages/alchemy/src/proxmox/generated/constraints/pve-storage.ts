/**
 * Generated pve-manager parameter constraints for `/storage` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/constraints.ts
 * Manifest entry: `pve-apidoc` — pve-manager 9.2.11/f6997e698c7933ea
 *   sha256 9def8f13611184ee, read on a PVE cluster node from
 *   /usr/share/pve-docs/api-viewer/apidoc.js
 *
 * 58 of this product's 258 POST/PUT endpoints are tabled across all areas: the ones
 * this package writes to, named in its own source. Every other vendor write endpoint is UNTABLED
 * and therefore unchecked at plan time.
 *
 * ⚠️ A `patternSource` with no `pattern` beside it is a rule that could NOT be carried into a
 *   JavaScript RegExp faithfully (codegen/pattern.ts). It is recorded and NOT enforced.
 * ⚠️ `pattern` IS NOT THE VENDOR'S SPELLING. For PVE it is anchored, because PVE applies
 *   `m/^$pattern$/` itself (JSONSchema.pm); for PBS it is the vendor's own, which already
 *   carries its anchors. `patternSource` is the spelling to quote at a human — param-rules.ts.
 * ⚠️ `each: true` means the value rules describe every ELEMENT of a repeated key, because the
 *   parameter is an array and stated its limits on `items`.
 */
import type { EndpointConstraints } from '../../constraints.ts';

export const PVE_STORAGE_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
  "pve:POST /storage": {
    "base": {"format":"pve-volume-id","type":"string"},
    "blocksize": {"format":"pve-storage-zfs-blocksize","type":"string"},
    "content": {"format":"pve-storage-content-list","type":"string"},
    "content-dirs": {"format":"pve-dir-override-list","type":"string"},
    "domain": {"maxLength":256,"type":"string"},
    "export": {"format":"pve-storage-path","type":"string"},
    "fingerprint": {"pattern":"^([A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}\\n?$","patternSource":"([A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}","type":"string"},
    "format": {"enum":["raw","qcow2","subvol","vmdk"],"type":"string"},
    "fs-name": {"format":"pve-configid","type":"string"},
    "max-protected-backups": {"default":"Unlimited for users with Datastore.Allocate privilege, 5 for other users","minimum":-1,"type":"integer"},
    "monhost": {"format":"pve-storage-portal-dns-list","type":"string"},
    "mountpoint": {"format":"pve-storage-path","type":"string"},
    "nodes": {"format":"pve-node-list","type":"string"},
    "options": {"format":"pve-storage-options","type":"string"},
    "password": {"maxLength":256,"type":"string"},
    "path": {"format":"pve-storage-path","type":"string"},
    "port": {"maximum":65535,"minimum":1,"type":"integer"},
    "portal": {"format":"pve-storage-portal-dns","type":"string"},
    "preallocation": {"default":"metadata","enum":["off","metadata","falloc","full"],"type":"string"},
    "prune-backups": {"format":"prune-backups","type":"string"},
    "saferemove-stepsize": {"default":"32","enum":["1","2","4","8","16","32"],"type":"integer"},
    "server": {"format":"pve-storage-server","type":"string"},
    "smbversion": {"default":"default","enum":["default","2.0","2.1","3","3.0","3.11"],"type":"string"},
    "storage": {"format":"pve-storage-id","required":true,"type":"string"},
    "subdir": {"format":"pve-storage-path","type":"string"},
    "thinpool": {"format":"pve-storage-vgname","type":"string"},
    "type": {"enum":["btrfs","cephfs","cifs","dir","esxi","iscsi","iscsidirect","lvm","lvmthin","nfs","pbs","rbd","zfs","zfspool"],"required":true,"type":"string"},
    "vgname": {"format":"pve-storage-vgname","type":"string"},
    "zfs-base-path": {"format":"pve-storage-path","type":"string"},
  },
  "pve:PUT /storage/{storage}": {
    "blocksize": {"format":"pve-storage-zfs-blocksize","type":"string"},
    "content": {"format":"pve-storage-content-list","type":"string"},
    "content-dirs": {"format":"pve-dir-override-list","type":"string"},
    "delete": {"format":"pve-configid-list","maxLength":4096,"type":"string"},
    "digest": {"maxLength":64,"type":"string"},
    "domain": {"maxLength":256,"type":"string"},
    "fingerprint": {"pattern":"^([A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}\\n?$","patternSource":"([A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}","type":"string"},
    "format": {"enum":["raw","qcow2","subvol","vmdk"],"type":"string"},
    "fs-name": {"format":"pve-configid","type":"string"},
    "max-protected-backups": {"default":"Unlimited for users with Datastore.Allocate privilege, 5 for other users","minimum":-1,"type":"integer"},
    "monhost": {"format":"pve-storage-portal-dns-list","type":"string"},
    "mountpoint": {"format":"pve-storage-path","type":"string"},
    "nodes": {"format":"pve-node-list","type":"string"},
    "options": {"format":"pve-storage-options","type":"string"},
    "password": {"maxLength":256,"type":"string"},
    "port": {"maximum":65535,"minimum":1,"type":"integer"},
    "preallocation": {"default":"metadata","enum":["off","metadata","falloc","full"],"type":"string"},
    "prune-backups": {"format":"prune-backups","type":"string"},
    "saferemove-stepsize": {"default":"32","enum":["1","2","4","8","16","32"],"type":"integer"},
    "server": {"format":"pve-storage-server","type":"string"},
    "smbversion": {"default":"default","enum":["default","2.0","2.1","3","3.0","3.11"],"type":"string"},
    "subdir": {"format":"pve-storage-path","type":"string"},
    "zfs-base-path": {"format":"pve-storage-path","type":"string"},
  },
};
