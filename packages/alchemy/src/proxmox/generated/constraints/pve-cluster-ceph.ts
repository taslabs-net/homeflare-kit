/**
 * Generated pve-manager parameter constraints for `/cluster/ceph` — DO NOT EDIT BY HAND.
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

export const PVE_CLUSTER_CEPH_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
  "pve:PUT /cluster/ceph/flags/{flag}": {
    "value": {"required":true,"type":"boolean"},
  },
};
