---
'@homeflare/alchemy': patch
---

Use the distilled OpenBao SDK for AppRole metadata reads, writes, deletes and rename
collision checks. Preserve omitted role settings and existing no-op, ownership and deletion
guards; permission and malformed-response failures never become absence. Reads and the
metadata write retain the existing bounded transport retry — the write sends every managed
field every time, so replaying it after a transport failure converges on the same role;
delete makes one attempt. Checked against the OpenBao 2.6.2 generated AppRole schema and
pinned vendor source. No login or credential issuance operations change.
