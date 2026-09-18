---
'@homeflare/alchemy': minor
---

Add `BaoAuthMethod` so a stack can enable `approle` (or jwt/oidc) instead of running `configure-engines`. Metadata only — no role ids or OIDC secrets. File audit stays out: OpenBao 2.6 file audit is config-only.
