/**
 * Generated NetBox REST API (OpenAPI 3.0.3) request-body constraints for `/api/ipam` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/netbox.ts
 * Manifest entry: `netbox-openapi` — NetBox REST API (OpenAPI 3.0.3) 4.7.0
 *   sha256 be7f971179b1d6ba, vendor repository, pinned to the release tag
 *   contrib/openapi.json in netbox-community/netbox, at tag v4.7.0
 *
 * 2 of this product's 949 POST/PUT/PATCH/DELETE endpoints are tabled across all
 * areas: the ones this package writes to, named in its own source. Every other vendor write
 * endpoint is UNTABLED and therefore unchecked at plan time.
 *
 * ⚠️ A `patternSource` with no `pattern` beside it could NOT be carried into a JavaScript
 *   RegExp faithfully — Python's `\w` is Unicode and JavaScript's is ASCII
 *   (codegen/py-pattern.ts). It is recorded and NOT enforced.
 * ⚠️ A FOREIGN KEY CARRIES ONLY ITS TYPE. `tenant`, `vlan`, `role` and friends are
 *   `integer|object` in the schema, and the related object's own rules do not govern them.
 */
import type { EndpointConstraints } from '../../constraints.ts';

export const NETBOX_IPAM_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
  "netbox:PATCH /api/ipam/prefixes/{id}/": {
    "description": {"maxLength":200,"type":"string"},
    "prefix": {"minLength":1,"type":"string"},
    "status": {"enum":["container","active","reserved","deprecated"],"type":"string"},
  },
  "netbox:POST /api/ipam/prefixes/": {
    "description": {"maxLength":200,"type":"string"},
    "prefix": {"minLength":1,"required":true,"type":"string"},
    "status": {"enum":["container","active","reserved","deprecated"],"type":"string"},
  },
};
