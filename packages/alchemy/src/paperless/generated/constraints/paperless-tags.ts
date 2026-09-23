/**
 * Generated Paperless-ngx REST API (OpenAPI 3.0.3) request-body constraints for `/api/tags/` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/paperless.ts
 * Manifest entry: `paperless-openapi` — Paperless-ngx REST API (OpenAPI 3.0.3) 3.1.1
 *   sha256 d0fe550d2135e37b, Paperless-ngx web service, loopback
 *   /api/schema/?format=json
 *
 * 8 of this product's 100 POST/PUT/PATCH/DELETE endpoints are tabled across all
 * areas: the ones this package writes to, named in its own source. Every other vendor write
 * endpoint is UNTABLED and therefore unchecked at plan time.
 *
 * ⚠️ A `patternSource` with no `pattern` beside it could NOT be carried into a JavaScript
 *   RegExp faithfully — Django/DRF's `\w` is Unicode and JavaScript's is ASCII
 *   (codegen/py-pattern.ts). It is recorded and NOT enforced.
 * ⚠️ `data_type` on a custom field is CREATE-ONLY: enforced here as a value rule, never as a
 *   reason to allow a PATCH — the refusal on change lives in the provider (custom-field.ts).
 */
import type { EndpointConstraints } from '../../constraints.ts';

export const PAPERLESS_TAGS_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
  "paperless:PATCH /api/tags/{id}/": {
    "color": {"maxLength":7,"minLength":1,"type":"string"},
    "match": {"maxLength":256,"type":"string"},
    "matching_algorithm": {"enum":[0,1,2,3,4,5,6],"type":"integer"},
    "name": {"maxLength":128,"minLength":1,"type":"string"},
  },
  "paperless:POST /api/tags/": {
    "color": {"maxLength":7,"minLength":1,"type":"string"},
    "match": {"maxLength":256,"type":"string"},
    "matching_algorithm": {"enum":[0,1,2,3,4,5,6],"type":"integer"},
    "name": {"maxLength":128,"minLength":1,"required":true,"type":"string"},
  },
};
