/**
 * Generated pve-manager parameter constraints for `/nodes/{node}/disks` — DO NOT EDIT BY HAND.
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

export const PVE_NODES_DISKS_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
  "pve:POST /nodes/{node}/disks/zfs": {
    "ashift": {"default":"12","maximum":16,"minimum":9,"type":"integer"},
    "compression": {"default":"on","enum":["on","off","gzip","lz4","lzjb","zle","zstd"],"type":"string"},
    "devices": {"format":"string-list","required":true,"type":"string"},
    "name": {"format":"pve-storage-id","required":true,"type":"string"},
    "raidlevel": {"enum":["single","mirror","raid10","raidz","raidz2","raidz3","draid","draid2","draid3"],"required":true,"type":"string"},
  },
};
