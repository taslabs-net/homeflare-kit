---
'@homeflare/alchemy': minor
---

Bump Alchemy to 2.0.0-beta.78 and Effect to 4.0.0-rc.115. Consumers must move the override set with it — Alchemy 78's peer is `effect >= rc.115`. Effect rc.115 renamed `Config.redacted` to `Config.Redacted`. `mime@4.1.0` is now a required peer: Alchemy's cloudflare-runtime imports it and does not declare it.
