/**
 * Generated pve-manager parameter constraints for `/cluster/replication` — DO NOT EDIT BY HAND.
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

export const PVE_CLUSTER_REPLICATION_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
  "pve:POST /cluster/replication": {
    "comment": {"maxLength":4096,"type":"string"},
    "id": {"format":"pve-replication-job-id","pattern":"^[1-9][0-9]{2,8}-\\d{1,9}\\n?$","patternSource":"[1-9][0-9]{2,8}-\\d{1,9}","required":true,"type":"string"},
    "rate": {"minimum":1,"type":"number"},
    "remove_job": {"enum":["local","full"],"type":"string"},
    "schedule": {"default":"*/15","format":"pve-calendar-event","maxLength":128,"type":"string"},
    "source": {"format":"pve-node","type":"string"},
    "target": {"format":"pve-node","required":true,"type":"string"},
    "type": {"enum":["local"],"required":true,"type":"string"},
  },
  "pve:PUT /cluster/replication/{id}": {
    "comment": {"maxLength":4096,"type":"string"},
    "delete": {"format":"pve-configid-list","maxLength":4096,"type":"string"},
    "digest": {"maxLength":64,"type":"string"},
    "rate": {"minimum":1,"type":"number"},
    "remove_job": {"enum":["local","full"],"type":"string"},
    "schedule": {"default":"*/15","format":"pve-calendar-event","maxLength":128,"type":"string"},
    "source": {"format":"pve-node","type":"string"},
  },
};
