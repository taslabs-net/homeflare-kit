/**
 * Generated pve-manager parameter constraints for `/nodes/{node}/ceph` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/constraints.ts
 * Manifest entry: `pve-apidoc` — pve-manager 9.2.11/f6997e698c7933ea
 *   sha256 9def8f13611184ee, read on a PVE cluster node from
 *   /usr/share/pve-docs/api-viewer/apidoc.js
 *
 * 59 of this product's 258 POST/PUT endpoints are tabled across all areas: the ones
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

export const PVE_NODES_CEPH_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
  "pve:POST /nodes/{node}/ceph/fs/{name}": {
    "pg_num": {"default":"128","maximum":32768,"minimum":8,"type":"integer"},
  },
  "pve:POST /nodes/{node}/ceph/mds/{name}": {},
  "pve:POST /nodes/{node}/ceph/mgr/{id}": {},
  "pve:POST /nodes/{node}/ceph/mon/{monid}": {
    "mon-address": {"format":"ip-list","type":"string"},
  },
  "pve:POST /nodes/{node}/ceph/osd": {
    "db_dev_size": {"minimum":1,"type":"number"},
    "dev": {"required":true,"type":"string"},
    "osds-per-device": {"minimum":1,"type":"integer"},
    "wal_dev_size": {"minimum":0.5,"type":"number"},
  },
  "pve:POST /nodes/{node}/ceph/pool": {
    "application": {"default":"rbd","enum":["rbd","cephfs","rgw"],"type":"string"},
    "min_size": {"default":"2","maximum":7,"minimum":1,"type":"integer"},
    "name": {"patternSource":"(?^:^[^:/\\s]+$)","required":true,"type":"string"},
    "pg_autoscale_mode": {"default":"warn","enum":["on","off","warn"],"type":"string"},
    "pg_num": {"default":"128","maximum":32768,"minimum":1,"type":"integer"},
    "pg_num_min": {"maximum":32768,"type":"integer"},
    "size": {"default":"3","maximum":7,"minimum":1,"type":"integer"},
    "target_size": {"pattern":"^^(\\d+(\\.\\d+)?)([KMGT])?$\\n?$","patternSource":"^(\\d+(\\.\\d+)?)([KMGT])?$","type":"string"},
  },
  "pve:PUT /nodes/{node}/ceph/pool/{name}": {
    "application": {"enum":["rbd","cephfs","rgw"],"type":"string"},
    "min_size": {"maximum":7,"minimum":1,"type":"integer"},
    "pg_autoscale_mode": {"enum":["on","off","warn"],"type":"string"},
    "pg_num": {"maximum":32768,"minimum":1,"type":"integer"},
    "pg_num_min": {"maximum":32768,"type":"integer"},
    "size": {"maximum":7,"minimum":1,"type":"integer"},
    "target_size": {"pattern":"^^(\\d+(\\.\\d+)?)([KMGT])?$\\n?$","patternSource":"^(\\d+(\\.\\d+)?)([KMGT])?$","type":"string"},
  },
};
