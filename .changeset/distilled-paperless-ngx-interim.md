---
'@homeflare/distilled-paperless-ngx': minor
---

Add `@homeflare/distilled-paperless-ngx`, an unmodified copy of the (not yet
upstream-published) `@distilled.cloud/paperless-ngx` SDK — 164 operations
across 30 Paperless-ngx API tags, generated from the vendor's own **served**
OpenAPI 3.0.3 document (Paperless-ngx commits no spec file; the pinned copy
is the one this estate's own instance serves, recorded in
`packages/alchemy/codegen/manifest.json` under id `paperless-openapi`,
pinned to `v3.1.1`), with typed `catchTag`-able errors for 404/403/400/etc.,
including the ones Paperless-ngx's own document omits but its Django REST
Framework stack produces uniformly.

Follows the interim-package route `@homeflare/distilled-netbox` (#183) and
`@homeflare/distilled-proxmox` (#185) already established — see
`packages/alchemy/docs/distilled-interim.md`. This PR does not alias
`@distilled.cloud/paperless-ngx` onto it and does not move any of the kit's
existing hand-written `packages/alchemy/src/paperless/*` resources — the
alias can only resolve once this package is actually on npm; that migration
is a follow-up PR.
