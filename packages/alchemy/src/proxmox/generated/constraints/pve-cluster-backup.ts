/**
 * Generated pve-manager parameter constraints for `/cluster/backup` — DO NOT EDIT BY HAND.
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

export const PVE_CLUSTER_BACKUP_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
  "pve:POST /cluster/backup": {
    "bwlimit": {"default":"0","minimum":0,"type":"integer"},
    "comment": {"maxLength":512,"type":"string"},
    "compress": {"default":"0","enum":["0","1","gzip","lzo","zstd"],"type":"string"},
    "dow": {"default":"mon,tue,wed,thu,fri,sat,sun","format":"pve-day-of-week-list","type":"string"},
    "exclude": {"format":"pve-vmid-list","type":"string"},
    "fleecing": {"format":"backup-fleecing","type":"string"},
    "id": {"format":"pve-configid","type":"string"},
    "ionice": {"default":"7","maximum":8,"minimum":0,"type":"integer"},
    "lockwait": {"default":"180","minimum":0,"type":"integer"},
    "mailnotification": {"default":"always","enum":["always","failure"],"type":"string"},
    "mailto": {"format":"email-or-username-list","type":"string"},
    "mode": {"default":"snapshot","enum":["snapshot","suspend","stop"],"type":"string"},
    "node": {"format":"pve-node","type":"string"},
    "notes-template": {"maxLength":1024,"type":"string"},
    "notification-mode": {"default":"auto","enum":["auto","legacy-sendmail","notification-system"],"type":"string"},
    "pbs-change-detection-mode": {"enum":["legacy","data","metadata"],"type":"string"},
    "performance": {"format":"backup-performance","type":"string"},
    "prune-backups": {"default":"keep-all=1","format":"prune-backups","type":"string"},
    "schedule": {"format":"pve-calendar-event","maxLength":128,"type":"string"},
    "starttime": {"pattern":"^\\d{1,2}:\\d{1,2}\\n?$","patternSource":"\\d{1,2}:\\d{1,2}","type":"string"},
    "stopwait": {"default":"10","minimum":0,"type":"integer"},
    "storage": {"format":"pve-storage-id","type":"string"},
    "vmid": {"format":"pve-vmid-list","type":"string"},
  },
  "pve:PUT /cluster/backup/{id}": {
    "bwlimit": {"default":"0","minimum":0,"type":"integer"},
    "comment": {"maxLength":512,"type":"string"},
    "compress": {"default":"0","enum":["0","1","gzip","lzo","zstd"],"type":"string"},
    "delete": {"format":"pve-configid-list","type":"string"},
    "dow": {"format":"pve-day-of-week-list","type":"string"},
    "exclude": {"format":"pve-vmid-list","type":"string"},
    "fleecing": {"format":"backup-fleecing","type":"string"},
    "ionice": {"default":"7","maximum":8,"minimum":0,"type":"integer"},
    "lockwait": {"default":"180","minimum":0,"type":"integer"},
    "mailnotification": {"default":"always","enum":["always","failure"],"type":"string"},
    "mailto": {"format":"email-or-username-list","type":"string"},
    "mode": {"default":"snapshot","enum":["snapshot","suspend","stop"],"type":"string"},
    "node": {"format":"pve-node","type":"string"},
    "notes-template": {"maxLength":1024,"type":"string"},
    "notification-mode": {"default":"auto","enum":["auto","legacy-sendmail","notification-system"],"type":"string"},
    "pbs-change-detection-mode": {"enum":["legacy","data","metadata"],"type":"string"},
    "performance": {"format":"backup-performance","type":"string"},
    "prune-backups": {"default":"keep-all=1","format":"prune-backups","type":"string"},
    "schedule": {"format":"pve-calendar-event","maxLength":128,"type":"string"},
    "starttime": {"pattern":"^\\d{1,2}:\\d{1,2}\\n?$","patternSource":"\\d{1,2}:\\d{1,2}","type":"string"},
    "stopwait": {"default":"10","minimum":0,"type":"integer"},
    "storage": {"format":"pve-storage-id","type":"string"},
    "vmid": {"format":"pve-vmid-list","type":"string"},
  },
};
