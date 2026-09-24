---
'@homeflare/alchemy': patch
---

Run PBS notification matchers and sendmail, SMTP and webhook targets through the distilled
Proxmox Backup Server SDK. Read failures now preserve their typed errors instead of planning
false creates; only typed NotFound means absence or an already completed delete. Keep leased
credentials, bounded requests, secret seals and no-op adoption. Vendor schema: PBS 4.2.6-1,
SDK 0.3.0.

Preflight replacement destinations, required write-only values and vendor/SDK input constraints
before deleting a working target. Typed destination read failures stop replacement; existing
renamed targets remain adoptable without requiring secret values the plan cannot observe.
