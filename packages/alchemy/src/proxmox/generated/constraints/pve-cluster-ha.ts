/**
 * Generated pve-manager parameter constraints for `/cluster/ha` — DO NOT EDIT BY HAND.
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

export const PVE_CLUSTER_HA_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
  "pve:POST /cluster/ha/resources": {
    "comment": {"maxLength":4096,"type":"string"},
    "group": {"format":"pve-configid","type":"string"},
    "max_relocate": {"default":"1","minimum":0,"type":"integer"},
    "max_restart": {"default":"1","minimum":0,"type":"integer"},
    "sid": {"format":"pve-ha-resource-or-vm-id","required":true,"type":"string"},
    "state": {"default":"started","enum":["started","stopped","enabled","disabled","ignored"],"type":"string"},
    "type": {"enum":["ct","vm"],"type":"string"},
  },
  "pve:POST /cluster/ha/rules": {
    "affinity": {"enum":["positive","negative"],"type":"string"},
    "comment": {"maxLength":4096,"type":"string"},
    "resources": {"format":"pve-ha-resource-id-list","required":true,"type":"string"},
    "rule": {"format":"pve-configid","required":true,"type":"string"},
  },
  "pve:PUT /cluster/ha/resources/{sid}": {
    "comment": {"maxLength":4096,"type":"string"},
    "delete": {"format":"pve-configid-list","maxLength":4096,"type":"string"},
    "digest": {"maxLength":64,"type":"string"},
    "group": {"format":"pve-configid","type":"string"},
    "max_relocate": {"default":"1","minimum":0,"type":"integer"},
    "max_restart": {"default":"1","minimum":0,"type":"integer"},
    "state": {"default":"started","enum":["started","stopped","enabled","disabled","ignored"],"type":"string"},
  },
  "pve:PUT /cluster/ha/rules/{rule}": {
    "affinity": {"enum":["positive","negative"],"type":"string"},
    "comment": {"maxLength":4096,"type":"string"},
    "delete": {"format":"pve-configid-list","maxLength":4096,"type":"string"},
    "digest": {"maxLength":64,"type":"string"},
    "resources": {"format":"pve-ha-resource-id-list","type":"string"},
  },
};
