---
'@homeflare/distilled-openbao': patch
---

Type the OpenBao auth-method and secrets-engine inventories as maps keyed by mount
path, using schemas derived from the OpenBao 2.6.2 server. Validate these two
responses so malformed or missing data cannot look like an empty inventory,
preserve unknown metadata, and keep response values out of parse errors.
