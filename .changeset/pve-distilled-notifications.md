---
'@homeflare/alchemy': patch
---

Move PVE notification targets and matchers onto generated distilled SDK operations.
Failed reads now stop the plan; only typed NotFound means absence. Keep matching
adoption write-free, preserve list items and explicit clearing, and validate read
payloads without exposing server values. Identity changes replace the old resource;
a same-name endpoint type change deletes first because names are shared across types.

Vendor schema: pve-manager 9.2.11. Read-only probes confirmed missing notification
GETs return 404; write behavior is exercised through the real SDK and Alchemy engine
against isolated fixtures, with no live notification changes.
