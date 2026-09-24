---
'@homeflare/alchemy': patch
---

Use the distilled OpenBao SDK for AppRole metadata reads, writes, deletes and rename
collision checks. Preserve omitted role settings and existing no-op, ownership and deletion
guards; permission and malformed-response failures never become absence. Checked against
the OpenBao 2.6.2 generated AppRole schema and pinned vendor source. No login or credential
issuance operations change.
