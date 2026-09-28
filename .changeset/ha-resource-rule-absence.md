---
'@homeflare/distilled-proxmox': patch
---

HA resource and HA rule reads now fail as `HaResourceNotFound` and `HaRuleNotFound` instead of a generic server error, and deleting an HA resource that is not managed fails as the same resource tag. A nearby sentence (a resource stuck in error state) stays a generic failure.
