---
'@homeflare/distilled-traefik': minor
'@homeflare/distilled-cilium': minor
'@homeflare/alchemy': patch
---

Add Distilled interim stubs for the Talos + Argo CD dogfood vendors that
are not on npm as `@distilled.cloud/<vendor>` yet, and record the honest
A/B/C decision for each.

**B — Scaffold (this release):** `@homeflare/distilled-traefik` and
`@homeflare/distilled-cilium`. Each is a Distilled-shaped surface
(Credentials, Errors, one stub operation, smoke) so a later PR can alias
`@distilled.cloud/traefik` / `@distilled.cloud/cilium` after publish.
`src/` is marked STUB and will be replaced by a regenerate+copy — Traefik
has no official OpenAPI; Cilium does (`api/v1/openapi.yaml`) and is the
next generate candidate. Apache-2.0, `@distilled.cloud/core@1.0.0-rc.12`,
peer `effect@4.0.0-rc.115`.

**C — Skip / use kubernetes Distilled:** Headlamp (UI; install via Argo /
Helm), CloudNativePG (CRDs on `postgresql.cnpg.io/v1`), Valkey (RESP
Sentinel + operator CRDs). No fake REST packages. Documented in
`packages/alchemy/docs/talos-argocd-dogfood.md`.

This PR does not alias the new packages into `@homeflare/alchemy` and does
not add Argo, Flux, or Talos CLI work. Next: publish → alias → Alchemy
providers.
